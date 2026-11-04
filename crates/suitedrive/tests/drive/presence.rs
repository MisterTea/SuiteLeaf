//! Who else has a file open.

use std::time::{Duration, SystemTime};

use suitedrive::{DriveError, PRESENCE_TTL, Presence, Role};

use crate::support::{node, user};

#[test]
fn presence_names_other_people_and_drops_stale_beats() {
    let n = node();
    let sam = user("sam");
    let jordan = user("jordan");
    let casey = user("casey");
    let file = n
        .drive
        .create(&sam, None, "Bake sale flyer.sldoc", "file", None)
        .unwrap();
    n.drive
        .share(&sam, &file.id, "user", "jordan", Some(Role::Viewer))
        .unwrap();
    n.drive
        .share(&sam, &file.id, "user", "casey", Some(Role::Commenter))
        .unwrap();
    let now = SystemTime::now();

    n.drive
        .report_presence(&jordan, &file.id, "Jordan", false, now)
        .unwrap();
    assert_eq!(
        n.drive.presence(&sam, &file.id, now).unwrap(),
        vec![Presence {
            name: "Jordan".into(),
            editing: false,
            idle: false,
        }]
    );

    n.drive
        .report_presence(&sam, &file.id, "Sam Okafor", true, now)
        .unwrap();
    assert_eq!(
        n.drive.presence(&sam, &file.id, now).unwrap(),
        vec![Presence {
            name: "Jordan".into(),
            editing: false,
            idle: false,
        }],
        "Sam does not see himself"
    );
    assert_eq!(
        n.drive.presence(&jordan, &file.id, now).unwrap(),
        vec![Presence {
            name: "Sam Okafor".into(),
            editing: true,
            idle: false,
        }]
    );

    n.drive
        .report_presence(&jordan, &file.id, "Jordan", true, now)
        .unwrap();
    assert_eq!(
        n.drive.presence(&sam, &file.id, now).unwrap(),
        vec![Presence {
            name: "Jordan".into(),
            editing: true,
            idle: false,
        }]
    );
    assert!(
        matches!(
            n.drive.write(&jordan, &file.id, None, None, b"changed"),
            Err(DriveError::Forbidden)
        ),
        "an editing beat does not let a viewer write"
    );

    n.drive
        .report_presence(&casey, &file.id, "Casey", false, now)
        .unwrap();
    assert_eq!(
        n.drive.presence(&sam, &file.id, now).unwrap(),
        vec![
            Presence {
                name: "Casey".into(),
                editing: false,
                idle: false,
            },
            Presence {
                name: "Jordan".into(),
                editing: true,
                idle: false,
            },
        ]
    );
    assert!(matches!(
        n.drive.write(&casey, &file.id, None, None, b"changed"),
        Err(DriveError::Forbidden)
    ));

    let quiet = now - Duration::from_secs(6);
    n.drive
        .report_presence(&jordan, &file.id, "Jordan", true, quiet)
        .unwrap();
    assert_eq!(
        n.drive.presence(&sam, &file.id, now).unwrap(),
        vec![
            Presence {
                name: "Casey".into(),
                editing: false,
                idle: false,
            },
            Presence {
                name: "Jordan".into(),
                editing: true,
                idle: true,
            },
        ]
    );

    let stale = now - (PRESENCE_TTL + Duration::from_secs(1));
    n.drive
        .report_presence(&jordan, &file.id, "Jordan", true, stale)
        .unwrap();
    assert_eq!(
        n.drive.presence(&sam, &file.id, now).unwrap(),
        vec![Presence {
            name: "Casey".into(),
            editing: false,
            idle: false,
        }],
        "a beat older than 15 seconds is absent"
    );

    let stranger = user("stranger");
    assert!(matches!(
        n.drive
            .report_presence(&stranger, &file.id, "Pat", false, now),
        Err(DriveError::Forbidden)
    ));
}
