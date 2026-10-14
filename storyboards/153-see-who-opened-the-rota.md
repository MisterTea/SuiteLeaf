# 153 · See who opened the rota

**Mode:** cluster · **App:** Admin · **Video:** [videos/153-see-who-opened-the-rota.mp4](videos/153-see-who-opened-the-rota.mp4) · **Script:** [scenes/153-see-who-opened-the-rota.spec.ts](scenes/153-see-who-opened-the-rota.spec.ts)

## Who and why

Rosa runs the garden club's SuiteLeaf server. She wants a Volunteers group inside Garden club, and she wants to see that Sam opened and edited the watering rota. Admin is only on the team server, and only for an admin.

## Inspired by

- [Nextcloud user management](https://docs.nextcloud.com/server/stable/admin_manual/configuration_user/user_configuration.html): create people, put them in groups, and disable an account without deleting their files.
- [ONLYOFFICE DocSpace audit tables](https://guides.onlyoffice.com/installation/docspace-general-config-tables.aspx): document actions and sign-ins are separate.
- [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md) WF-C4-01: an admin can see what a person opened and changed.

## Scenes

1. **Admin is in the sidebar.** Rosa signs in. The sidebar has Admin. Sam, who is not an admin, would not see it.
2. **Two groups.** She opens Admin, chooses Groups, and creates Garden club, then Volunteers.
3. **Nest them.** She opens Garden club and adds Volunteers.
4. **No loop.** She opens Volunteers and tries to add Garden club. Admin says that would make a loop, and Volunteers does not contain Garden club.
5. **Sam's trail.** She opens People, then Sam. Documents lists that he edited the watering rota and that he opened it.
6. **Sam is not an admin.** She signs out. Sam signs in. The sidebar has no Admin link.

## Success looks like

- Garden club contains Volunteers.
- Putting Garden club inside Volunteers is refused.
- Sam's page lists the edit and the open, with the rota's name.
- Signed in as Sam, Admin is not in the sidebar.

## Gaps and notes

- The first account on a new server is the admin. Later accounts are not, until an admin changes their role.
- Disabling someone keeps their files and ends their sessions. Removing them asks who should own the files.
- Storage is shown as the size of the files they own. There is no quota.
- Opens of the same file by the same person inside 15 minutes count once. Edits already in version history are listed even if they happened before Admin existed.
