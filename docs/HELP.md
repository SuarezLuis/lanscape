# LANscape help

LANscape watches your home network from your Umbrel: internet speed, latency, the devices on your network, and alerts when something changes.

## First run

The first time you open LANscape it asks you to set a password. Umbrel's own login doesn't cover apps on the host network, so without one anyone on your Wi-Fi could open LANscape. You can change the password later in **Settings**.

**Forgot it?** Create an empty file named `reset-password` in LANscape's data folder, `~/umbrel/app-data/sz-lanscape/data`, then restart the app. The password is cleared and the next visit asks for a new one.

## Speed tests

**Run speed test** measures ping, download and upload against a nearby speedtest.net server, with a live gauge. **Stop** cancels it.

Before each test LANscape also pings your router and your internet host, so the history shows your latency when the network is idle, not just under load.

- A full test takes about 25 seconds, slows your network while it runs, and can transfer 2 GB or more on a fast connection. If your plan has a data cap, keep scheduled tests infrequent.
- **History** shows speed and latency over the last day, week, month, year or all time. The latency chart can show full tests, ping checks, or both.
- Click a column header in the table to sort by it.

## Network

The **Network** page lists every device that answers on your network: name, IP address, maker, MAC address, and when it was first and last seen.

- **Names** come from what devices announce on the network (TVs, speakers, computers). Many devices, like smart plugs, don't announce one. Click any name to set your own.
- **Maker** comes from the first half of the MAC address. Phones and laptops often use a private, randomized address, shown as hidden.
- **Online** means the device answered the latest scan. Phones and plugs that are asleep can briefly show as away.
- **New** marks devices you haven't acknowledged yet. Open a device and switch on **Known device**, or use **Mark all known**.
- **Click a device** to see its details and history (when it came online and went offline), and to set **Alert when offline**: LANscape alerts once when it has been quiet for 5, 10, 30 or 60 minutes, and once when it's back. Watched devices show a **Watched** badge.
- **Export CSV** downloads the device list.

### Identify a device

Not sure what `Espressif Inc. · 192.168.0.43` is? Click **Identify a device**:

1. Scan with the device on.
2. Turn it off (or unplug it) and scan again. Whatever went quiet is a candidate.
3. If more than one device went quiet, turn it back on and scan once more. Only the one that comes back is it.

Then name it right there.

## Automations

- **Full speed test:** off by default. Choose every hour, 6 hours, 12 hours or daily, and a starting time. Times follow the time zone of the browser you last saved from. **Server** picks the speedtest.net server for every test; *Automatic* uses the nearest one, while a fixed server keeps results comparable over time.
- **Ping check:** every minute by default. Pings your router and an internet host (1.1.1.1 unless you change it) to track latency and packet loss, using almost no data. It skips minutes when a full test is running.
- **Device scan:** every 5 minutes by default. Keeps the device list current and spots new devices.

Each card shows its last scheduled run and what happened, including errors.

Ping data older than 90 days is kept as hourly averages, so the database stays small.

## Notifications

### Rules

A rule watches one measurement: download, upload, speed test ping, jitter, router or internet ping, or router or internet packet loss. It alerts when the value goes above or below either:

- **a fixed value**, like *router ping above 20 ms*, or
- **a percentage from normal**, like *download 50% below normal*. "Normal" is the median of the last 7 days, and needs at least 5 speed tests or an hour of ping checks before the rule can fire.

For ping rules, **how long** sets how long the problem has to last before you hear about it, so one dropped packet doesn't wake you up.

Each rule sends **one** alert when a problem starts and **one** when it clears. Three starter rules are included, all off.

**New device joins the network** alerts when an unknown device appears. For the first 24 hours after the first scan, new devices are recorded quietly, since sleeping devices take a while to show up.

### Where alerts go

Alerts always appear under **Recent alerts**. They also go to every channel you set up:

- **ntfy:** install the ntfy app, subscribe to a hard-to-guess topic, and paste the topic URL (for example `https://ntfy.sh/your-secret-topic`).
- **Telegram:**
  1. In Telegram, open [@BotFather](https://t.me/BotFather), send `/newbot` and follow the prompts.
  2. Paste the token it gives you and click **Save**.
  3. Open your new bot and press **Start**. It replies with your chat ID.
  4. Click **Find chat ID**, then **Save** and **Send test**.
- **Discord:** in a channel's settings, go to Integrations, Webhooks, New Webhook, and copy the URL.
- **Slack:** add an Incoming Webhook to a Slack app and paste its URL.
- **Webhook:** LANscape POSTs JSON with `app`, `time`, `kind` (`problem`, `resolved`, `device` or `test`), `title`, `message`, `metric`, `value` and `baseline`. Works with Home Assistant, n8n and similar tools.

A channel whose last delivery failed shows **Failing**, with the error.

## Settings

- **Change password**, which signs out every other browser.
- **Sign out**, or **Sign out everywhere**.
- **Export data:** speed tests, ping checks and devices as CSV files.

## Privacy

LANscape keeps everything on your Umbrel. It only reaches the internet for:

- speed tests (speedtest.net servers) and pings to your internet host
- alert channels you set up
- this help page, which your browser loads from GitHub

Speed test results include your public IP address; LANscape never stores it.

## Troubleshooting

- **The Telegram bot doesn't reply:** make sure you messaged the bot whose token you saved; the Telegram panel's **Find chat ID** names the right bot. The bot replies within a few seconds while LANscape is running.
- **A device keeps showing as away:** it's probably asleep. Phones and battery devices often skip scans.
- **A speed test fails right away:** check the Umbrel has internet access. The error appears under the button and on the Automations page.
- **Something else:** open an issue at [github.com/SuarezLuis/lanscape](https://github.com/SuarezLuis/lanscape/issues).
