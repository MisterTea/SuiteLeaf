//! The collaboration WebSocket: sign-in, join, and the message loop.

use std::sync::Arc;

use axum::{
    extract::{
        Path, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode, header},
    response::IntoResponse,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use suitedrive::{Drive, Principal, Role};

use super::{
    Join, LiveUpdate, ROOM_SHARED, Rooms,
    presence::{iso_from_ms, now_ms, role_of},
};
use crate::{
    auth::{Auth, AuthUser},
    http::AppState,
};

#[derive(Deserialize)]
pub struct TokenQuery {
    access_token: Option<String>,
}

pub async fn session(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<TokenQuery>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> impl IntoResponse {
    let mut headers = headers;
    if let Some(token) = query.access_token.as_deref()
        && let Ok(value) = format!("Bearer {token}").parse()
    {
        headers.insert(header::AUTHORIZATION, value);
    }
    let preauth = state.auth.user(&headers);
    if query.access_token.is_some() && preauth.is_none() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let drive = state.drive.clone();
    let rooms = state.rooms.clone();
    if let Some(user) = preauth {
        let role = match accepted_role(drive, &user, &id).await {
            Ok(role) => role,
            Err(status) => return status.into_response(),
        };
        return upgrade
            .on_upgrade(move |socket| async move {
                let _ = run_socket(socket, rooms, id, user, role).await;
            })
            .into_response();
    }
    // The browser cannot set an Authorization header on a WebSocket. The
    // token arrives in the first message so it is not written into the URL.
    let auth = state.auth.clone();
    upgrade
        .on_upgrade(move |mut socket| async move {
            let Some(user) = read_auth_user(&mut socket, &auth).await else {
                let _ = socket
                    .send(Message::Text(
                        json!({"type":"error","reason":"unauthorized"})
                            .to_string()
                            .into(),
                    ))
                    .await;
                return;
            };
            let role = match accepted_role(drive, &user, &id).await {
                Ok(role) => role,
                Err(_) => {
                    let _ = socket
                        .send(Message::Text(
                            json!({"type":"error","reason":"forbidden"})
                                .to_string()
                                .into(),
                        ))
                        .await;
                    return;
                }
            };
            let _ = run_socket(socket, rooms, id, user, role).await;
        })
        .into_response()
}

async fn accepted_role(
    drive: Arc<Drive>,
    user: &AuthUser,
    item_id: &str,
) -> Result<Role, StatusCode> {
    let who = Principal {
        id: user.id.clone(),
        admin: user.is_admin(),
    };
    let item_id = item_id.to_owned();
    match tokio::task::spawn_blocking(move || role_of(&drive, &who, &item_id)).await {
        Ok(Ok(Some(role))) => Ok(role),
        Ok(Ok(None)) => Err(StatusCode::FORBIDDEN),
        _ => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

/// The first socket message must be `{type:"auth", accessToken}`. The token
/// is not logged.
async fn read_auth_user(socket: &mut WebSocket, auth: &Auth) -> Option<AuthUser> {
    let message = tokio::time::timeout(std::time::Duration::from_secs(5), socket.recv()).await;
    let Ok(Some(Ok(Message::Text(text)))) = message else {
        return None;
    };
    let value: Value = serde_json::from_str(text.as_str()).unwrap_or(Value::Null);
    if let Err(reason) = protocol_supported(&value) {
        let _ = socket
            .send(Message::Text(
                json!({"type": "reject", "reason": reason})
                    .to_string()
                    .into(),
            ))
            .await;
        return None;
    }
    let token = auth_token(&value)?;
    let mut headers = HeaderMap::new();
    let Ok(header_value) = format!("Bearer {token}").parse() else {
        return None;
    };
    headers.insert(header::AUTHORIZATION, header_value);
    auth.user(&headers)
}

/// The browser and this node both speak protocol 1. A missing number is 1.
pub(crate) const COLLAB_PROTOCOL: i64 = 1;

pub(crate) fn protocol_supported(value: &Value) -> Result<(), &'static str> {
    match value.get("protocol") {
        None => Ok(()),
        Some(number) if number.as_i64() == Some(COLLAB_PROTOCOL) => Ok(()),
        Some(_) => Err("This app speaks collaboration protocol 1."),
    }
}

pub(crate) fn auth_token(value: &Value) -> Option<&str> {
    if value.get("type").and_then(|v| v.as_str()) != Some("auth") {
        return None;
    }
    let token = value.get("accessToken").and_then(|v| v.as_str())?.trim();
    if token.is_empty() || token.len() > 8_192 || token.contains('\n') || token.contains('\r') {
        return None;
    }
    Some(token)
}

async fn run_socket(
    socket: WebSocket,
    rooms: Rooms,
    item: String,
    user: AuthUser,
    role: Role,
) -> anyhow::Result<()> {
    let (mut sink, mut stream) = socket.split();
    let joined = rooms.join(&item, &user, role, now_ms())?;
    sink.send(Message::Text(
        joined_message(&rooms, &item, &joined)?.into(),
    ))
    .await?;
    let mut relay = {
        let live = rooms.live.lock().expect("rooms");
        live.get(&item).map(|room| room.relay.subscribe())
    };
    loop {
        let incoming = tokio::select! {
            message = stream.next() => message,
            remote = async {
                match relay.as_mut() {
                    Some(relay) => relay.recv().await.ok(),
                    None => std::future::pending().await,
                }
            } => {
                if let Some(update) = remote
                    && !update.is_empty()
                {
                    if update == ROOM_SHARED {
                        let again = rooms.join(&item, &user, role, now_ms())?;
                        let _ = sink
                            .send(Message::Text(
                                joined_message(&rooms, &item, &again)?.into(),
                            ))
                            .await;
                    } else if let Some(body) = update.strip_prefix("sel:") {
                        let _ = sink.send(Message::Text(body.to_owned().into())).await;
                    } else {
                        let _ = sink
                            .send(Message::Text(
                                json!({"type":"update","update": update}).to_string().into(),
                            ))
                            .await;
                    }
                }
                continue;
            }
        };
        let Some(message) = incoming else { break };
        let Message::Text(text) = message? else {
            continue;
        };
        let value: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        let kind = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if rooms.session_expired(&user.id)?
            || rooms.access_ended(&user.id, user.is_admin(), &item)?
        {
            let _ = sink
                .send(Message::Text(
                    json!({"type":"error","reason":"unauthorized"})
                        .to_string()
                        .into(),
                ))
                .await;
            break;
        }
        match kind {
            "activity" | "join" => {
                rooms.activity(&item, &user.id, now_ms())?;
                if kind == "join" {
                    if let Err(reason) = protocol_supported(&value) {
                        let _ = sink
                            .send(Message::Text(
                                json!({"type":"reject","reason":reason}).to_string().into(),
                            ))
                            .await;
                        break;
                    }
                    let again = rooms.join(&item, &user, role, now_ms())?;
                    sink.send(Message::Text(joined_message(&rooms, &item, &again)?.into()))
                        .await?;
                }
            }
            "update" | "seed" => {
                let Some(encoded) = value.get("update").and_then(|v| v.as_str()) else {
                    continue;
                };
                let bytes = STANDARD.decode(encoded).unwrap_or_default();
                let unit = if kind == "seed" {
                    "seed"
                } else {
                    value
                        .get("unit")
                        .and_then(|v| v.as_str())
                        .unwrap_or("paragraph")
                };
                let key = value.get("key").and_then(|v| v.as_str()).unwrap_or("0");
                let at = value
                    .get("at")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_owned();
                let at = if at.is_empty() {
                    iso_from_ms(now_ms())
                } else {
                    at
                };
                let name = user.name.clone().unwrap_or_else(|| "You".into());
                let applied = rooms.apply_update(LiveUpdate {
                    item: &item,
                    user_id: &user.id,
                    name: &name,
                    role,
                    bytes: &bytes,
                    unit,
                    key,
                    at: &at,
                })?;
                if applied {
                    rooms.activity(&item, &user.id, now_ms())?;
                }
                if let Some(reply) = update_reply(
                    applied,
                    value.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                ) {
                    sink.send(Message::Text(reply.into())).await?;
                }
            }
            "selection" => {
                if value.get("text").is_some() || value.get("update").is_some() {
                    continue;
                }
                let name = user.name.clone().unwrap_or_else(|| "You".into());
                if value.get("sheetId").is_some() {
                    let Some(sheet_id) = value.get("sheetId").and_then(|v| v.as_str()) else {
                        continue;
                    };
                    let sheet_id = sheet_id.trim();
                    if sheet_id.is_empty()
                        || sheet_id.len() > 80
                        || sheet_id.chars().any(|c| c.is_control())
                    {
                        continue;
                    }
                    let Some(start_row) = value.get("startRow").and_then(|v| v.as_u64()) else {
                        continue;
                    };
                    let Some(start_column) = value.get("startColumn").and_then(|v| v.as_u64())
                    else {
                        continue;
                    };
                    let Some(end_row) = value.get("endRow").and_then(|v| v.as_u64()) else {
                        continue;
                    };
                    let Some(end_column) = value.get("endColumn").and_then(|v| v.as_u64()) else {
                        continue;
                    };
                    if start_row > 1_000_000
                        || start_column > 1_000_000
                        || end_row > 1_000_000
                        || end_column > 1_000_000
                        || end_row < start_row
                        || end_column < start_column
                    {
                        continue;
                    }
                    let body = json!({
                        "type": "selection",
                        "name": name,
                        "sheetId": sheet_id,
                        "startRow": start_row,
                        "startColumn": start_column,
                        "endRow": end_row,
                        "endColumn": end_column,
                    })
                    .to_string();
                    rooms.relay_text(&item, &format!("sel:{body}"));
                    continue;
                }
                if value.get("slideId").is_some() {
                    let Some(slide_id) = value.get("slideId").and_then(|v| v.as_str()) else {
                        continue;
                    };
                    let slide_id = slide_id.trim();
                    if slide_id.is_empty()
                        || slide_id.len() > 80
                        || slide_id.chars().any(|c| c.is_control())
                    {
                        continue;
                    }
                    let element_id = match value.get("elementId").and_then(|v| v.as_str()) {
                        None => None,
                        Some(id) => {
                            let id = id.trim();
                            if id.is_empty() || id.len() > 80 || id.chars().any(|c| c.is_control())
                            {
                                continue;
                            }
                            Some(id)
                        }
                    };
                    let mut body = json!({
                        "type": "selection",
                        "name": name,
                        "slideId": slide_id,
                    });
                    if let Some(element_id) = element_id {
                        body["elementId"] = json!(element_id);
                    }
                    rooms.relay_text(&item, &format!("sel:{}", body));
                    continue;
                }
                let Some(anchor) = value.get("anchor").and_then(|v| v.as_u64()) else {
                    continue;
                };
                let Some(head) = value.get("head").and_then(|v| v.as_u64()) else {
                    continue;
                };
                if anchor > 1_000_000 || head > 1_000_000 {
                    continue;
                }
                let body = json!({
                    "type": "selection",
                    "name": name,
                    "anchor": anchor,
                    "head": head,
                })
                .to_string();
                rooms.relay_text(&item, &format!("sel:{body}"));
            }
            _ => {}
        }
    }
    rooms.leave(&item, &user.id, now_ms())?;
    Ok(())
}

/// An acknowledgement means the update is in the journal. A refusal is not stored.
/// The reply names the update id and not the document bytes.
fn update_reply(applied: bool, id: &str) -> Option<String> {
    if id.is_empty() || id.len() > 80 || id.contains('\n') || id.contains('\r') {
        return None;
    }
    Some(
        json!({
            "type": if applied { "ack" } else { "reject" },
            "id": id,
        })
        .to_string(),
    )
}

fn joined_message(rooms: &Rooms, item: &str, joined: &Join) -> anyhow::Result<String> {
    let occupants = rooms
        .occupants(item)?
        .into_iter()
        .map(|person| json!({ "name": person.name, "role": person.role }))
        .collect::<Vec<_>>();
    Ok(json!({
        "type": "joined",
        "joined": joined.joined,
        "mode": joined.mode,
        "state": joined.state,
        "seed": joined.seed,
        "occupants": occupants,
    })
    .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_acknowledgement_names_the_update_and_not_the_document() {
        let ack = update_reply(true, "edit-1").unwrap();
        assert!(ack.contains("\"type\":\"ack\""));
        assert!(ack.contains("edit-1"));
        assert!(!ack.contains("Tomatoes"));
        let reject = update_reply(false, "view-1").unwrap();
        assert!(reject.contains("\"type\":\"reject\""));
        assert!(update_reply(true, "").is_none());
        assert!(update_reply(true, "line\nbreak").is_none());
    }

    #[test]
    fn an_auth_message_is_the_only_place_a_token_is_accepted() {
        assert_eq!(
            auth_token(&json!({"type":"auth","accessToken":"abc.def.ghi"})),
            Some("abc.def.ghi")
        );
        assert_eq!(
            auth_token(&json!({"type":"update","accessToken":"secret"})),
            None
        );
        assert_eq!(auth_token(&json!({"type":"auth","accessToken":"  "})), None);
        assert_eq!(
            auth_token(&json!({"type":"auth","accessToken":"line\nbreak"})),
            None
        );
        assert!(protocol_supported(&json!({"type":"auth","accessToken":"abc"})).is_ok());
        assert!(protocol_supported(&json!({"type":"auth","protocol": 1})).is_ok());
        let refused = protocol_supported(&json!({"type":"auth","protocol":"secret-value"}));
        assert_eq!(refused, Err("This app speaks collaboration protocol 1."));
        assert!(!refused.unwrap_err().contains("secret-value"));
        assert!(protocol_supported(&json!({"protocol": 2})).is_err());
        let join = protocol_supported(&json!({"type":"join","protocol":"secret-value"}));
        assert_eq!(join, Err("This app speaks collaboration protocol 1."));
        assert!(protocol_supported(&json!({"type":"join","protocol":1})).is_ok());
    }
}
