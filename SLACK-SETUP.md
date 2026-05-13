# Slack Integration Setup – PlayGround Points

## How It Works

The bot **only monitors one channel** (default: `#recognition`). When someone posts a recognition message there, it automatically:

1. Detects who is being recognized (via `@mentions`)
2. Detects the category (teamwork, innovation, leadership, etc.)
3. Detects points (explicit `+25` or auto-assigned based on keywords)
4. Logs it to the PlayGround Points app
5. Reacts with ⭐ to confirm it was captured

---

## Step 1: Create a Slack App

1. Go to **[api.slack.com/apps](https://api.slack.com/apps)** and click **Create New App**
2. Choose **From scratch**
3. Name it `PlayGround Points` and select your workspace
4. Click **Create App**

## Step 2: Set Bot Permissions

Go to **OAuth & Permissions** → **Scopes** → **Bot Token Scopes** and add:

| Scope | Why |
|-------|-----|
| `channels:history` | Read messages in the recognition channel |
| `channels:read` | Get channel info |
| `chat:write` | Post confirmation messages |
| `commands` | Handle `/recognize` slash command |
| `reactions:write` | Add ⭐ reaction to captured messages |
| `users:read` | Get user display names |

## Step 3: Enable Socket Mode

1. Go to **Socket Mode** in the sidebar → Toggle **ON**
2. Generate an **App-Level Token** with scope `connections:write`
3. Copy the token (starts with `xapp-`)

## Step 4: Install to Workspace

1. Go to **Install App** → Click **Install to Workspace**
2. Authorize the permissions
3. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

## Step 5: Enable Events

1. Go to **Event Subscriptions** → Toggle **ON**
2. Under **Subscribe to bot events**, add: `message.channels`
3. Save

## Step 6: Add Slash Command (Optional)

1. Go to **Slash Commands** → **Create New Command**
2. Command: `/recognize`
3. Description: `Recognize a colleague on PlayGround Points`
4. Usage hint: `@user [points] [category] [message]`

## Step 7: Invite the Bot to Your Channel

In Slack, go to your `#recognition` channel and type:
```
/invite @PlayGround Points
```

## Step 8: Set Environment Variables & Run

```powershell
$env:SLACK_BOT_TOKEN = "xoxb-your-bot-token"
$env:SLACK_SIGNING_SECRET = "your-signing-secret"
$env:SLACK_APP_TOKEN = "xapp-your-app-token"
$env:RECOGNITION_CHANNEL = "recognition"

npm install
npm start
```

---

## Message Formats the Bot Understands

In the `#recognition` channel, these all work:

```
@sarah kudos for amazing teamwork! +25
```
```
:star: @john great leadership during the sprint!
```
```
@mike @lisa props for the innovative solution +50
```
```
Thanks @alex for always supporting the team :trophy:
```
```
/recognize @sarah 25 innovation Brilliant idea on the new feature!
```

### Auto-Detection Rules

| What | How It Detects |
|------|---------------|
| **Recipient** | `@mentioned` users in the message |
| **Points** | Explicit `+25` in message, or auto: 🏆=25, 💯=50, default=10 |
| **Category** | Keyword matching: "team"→Teamwork, "idea"→Innovation, etc. |

---

## API Endpoints

Once running, the server exposes:

| Endpoint | Description |
|----------|-------------|
| `GET /api/recognitions` | All recognitions (latest first) |
| `GET /api/recognitions/user/:name` | Recognitions for a specific user |
| `GET /api/leaderboard` | Points leaderboard |
| `GET /api/stats` | Summary statistics |
| `GET /api/health` | Bot status check |
