//! Multiple tabs signed in with one account use the ordinary shared room.

use crate::support::*;

#[tokio::test(flavor = "multi_thread")]
async fn same_user_tabs_converge_and_closing_one_keeps_the_other_room_alive() {
    let cluster = Cluster::boot().await;
    let notes = cluster.shared_notes().await;
    let mut tabs = cluster.editors(0, &notes, &["maya", "maya"]).await;
    different_paragraphs_converge(&tabs).await;
    let generation = tabs[0].generation();
    drop(tabs.remove(1));
    cluster
        .wait_until("only the remaining tab has presence", || async {
            let rows = cluster
                .db(
                    0,
                    serde_json::json!({
                        "op": "findMany", "model": "drive_presence",
                        "where": [{ "field": "itemId", "value": notes }]
                    }),
                )
                .await;
            rows.as_array().is_some_and(|rows| rows.len() == 1)
        })
        .await;
    let update = {
        let inner = tabs[0].state.lock().expect("client");
        replace_paragraph(&inner.doc, 0, "Still editing")
    };
    tabs[0].send_update(&update, "paragraph", "0");
    wait_paragraphs(&tabs, &["Still editing", "Beans are staked"]).await;
    let other_tab = cluster.connect(0, &notes, "maya").await;
    tabs.push(other_tab);
    wait_paragraphs(&tabs, &["Still editing", "Beans are staked"]).await;
    assert_eq!(tabs[1].generation(), generation);
    drop(tabs);
    cluster
        .wait_until("last tab closes and the file is saved", || async {
            cluster
                .read_content(0, cluster.person("maya"), &notes)
                .await
                .is_some_and(|bytes| contains(&bytes, "Still editing"))
        })
        .await;
}
