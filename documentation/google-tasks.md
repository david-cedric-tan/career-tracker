# Google Tasks sync

Settings → **Google Tasks** copies your todos into a Google Tasks list named
**Career Tracker**. From there they show up in the Google Calendar and Google
Tasks apps on your phone.

- **One way only.** Edits, completions and deletes in the app reach Google
  within a few seconds. Changes made in Google don't come back, and the next
  edit here overwrites them.
- **Time.** Google Tasks stores a date only, so a timed todo gets a
  `Time: 2:00 PM – 3:30 PM` line at the top of the task's notes.
- **Cancelled** todos are removed from Google. **Done** todos show as completed.
- **Disconnect** stops syncing but leaves the tasks already in Google. Delete
  the list in Google Tasks if you want them gone.

## One-time setup (server owner)

1. Go to <https://console.cloud.google.com/> and create a project (any name).
2. **APIs & Services → Library**: enable **Google Tasks API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type: **External**.
   - Add the scope `https://www.googleapis.com/auth/tasks`.
   - **Audience → Publish app** ("In production"). While the app is left in
     *Testing*, Google expires the connection every 7 days. You don't need
     Google's verification for personal use. When you connect, Google warns
     that the app isn't verified: choose **Advanced → Go to … (unsafe)**.
4. **Credentials → Create credentials → OAuth client ID**, application type
   **Desktop app**. It has to be *Desktop app*: that type is the only one
   that allows the `http://localhost` return address this app relies on.
5. Put the ID and secret in `backend/.env`, then restart the backend:

   ```
   GOOGLE_OAUTH_CLIENT_ID=1234-abc.apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
   # optional, defaults to "Career Tracker"
   GOOGLE_TASKS_LIST_TITLE=Career Tracker
   ```

6. Run `python manage.py migrate`.

## Connecting (each user)

Open Settings → Google Tasks → **Connect Google Tasks**, then allow access.

- **On the computer running the app** (`http://localhost:5173`), Google returns
  straight to Settings and the connection finishes by itself.
- **Anywhere else** (your phone, the LAN address, the tunnel), Google ends on a
  `http://localhost/google-tasks?...` page that fails to load. That's expected.
  Copy that page's full address from the address bar, paste it into the box in
  Settings, and press **Finish connecting**.

Your existing todos are sent over right after you connect. **Resync all**
sends them again, which is useful after a restore or if something looks out
of step.

## Seeing it on an Oppo / ColorOS phone

The ColorOS calendar's own to-do list can't be written to by other apps. On
the phone, open the **Google Calendar** app, make sure **Tasks** is ticked in
its side menu, and the Career Tracker tasks appear on their due dates. The
**Google Tasks** app shows the list too.
