# LANscape help

LANscape watches your home network from your Umbrel: internet speed, latency, the devices on your network, and alerts when something changes.

## Signing in

Umbrel's own login doesn't cover apps on the host network, so LANscape has its own password. On Umbrel it starts with the password Umbrel generated for it: open LANscape's menu on the Umbrel home screen to see it. You can change it in **Settings**, and **Reset to the Umbrel password** there switches back.

**Forgot it?** In Umbrel, open LANscape's settings, set `RESET_PASSWORD` to `yes` and restart the app. The password goes back to the one Umbrel shows. Clear the setting afterwards, or each restart resets it again.

**Running LANscape on plain Docker** (see the README), set `APP_PASSWORD` in the compose file and sign in with it; **Reset to APP_PASSWORD** in Settings switches back to it. Without `APP_PASSWORD`, the first visit asks you to set a password. To reset a forgotten one, create an empty file named `reset-password` in the data folder (the volume mounted at `/data`) and restart the container: it goes back to `APP_PASSWORD`, or to the first-visit screen without one.

## Overview

The home screen, with one tile per question: is the internet **up** right now (and its health score), the **latest speed test** (against your plan, if you've entered it), **outages** in the last week, **services** with trouble, **devices** online and new since your last visit, and the **latest alerts**. Each tile's **Details** opens the full page. It refreshes every 30 seconds.

"New since your last visit" is remembered by your browser, so each browser keeps its own; the first time, it shows the last day.

## Speed tests

**Run speed test** measures ping, download and upload against a nearby speedtest.net server, with a live gauge. **Stop** cancels it.

Before each test LANscape also pings your router and your internet host, so the history shows your latency when the network is idle, not just under load.

- A full test takes about 25 seconds, slows your network while it runs, and can transfer 2 GB or more on a fast connection. If your plan has a data cap, keep scheduled tests infrequent.
- **History** shows speed and latency over the last day, week, month, year or all time. The latency chart can show full tests, ping checks, or both.
- Click a column header in the table to sort by it.

### Internet health

**Internet health** scores your connection from 0 to 100 over the last 24 hours, with the last 7 days next to it for comparison. It comes from the ping checks to your internet host, in four parts:

| Part | Weight | Full points | No points |
| --- | --- | --- | --- |
| Uptime (time not in an outage) | 40% | 100% | 98% or less (about 30 minutes down a day) |
| Packet loss, outside outages | 25% | 0% | 5% or more |
| Internet ping (median) | 20% | 20 ms or less | 150 ms or more |
| Jitter (median) | 15% | 2 ms or less | 30 ms or more |

Each part scores in a straight line between those values, and the score is their weighted average: 90 and up is Excellent, 75 Good, 50 Fair, below that Poor. The card shows each part's value and points, so you can see what pulled the score down. It needs half an hour of ping checks to start.

### Outages

**Outages** lists the times your internet was down over the last day, week, month or year: when each started, how long it lasted, and where the problem was, with a timeline above. An outage is two or more ping checks in a row where every packet to your internet host was lost; one lost check on its own is treated as a blip. Outages come from ping checks, so ping checks need to be on (Automations).

Each outage is compared with your router's pings at the same time:

- **Past router:** the router kept answering, so the problem was with your internet provider or beyond.
- **Home network:** the router didn't answer either, so it was the router itself, or the Umbrel's connection to it (cable, switch or Wi-Fi).

Ping checks older than 90 days are kept as hourly averages, but the outages in them are saved first, so the year view still shows short ones.

## Network

The **Network** page lists every device that answers on your network: name, IP address, maker, MAC address, and when it was first and last seen.

- **Names** come from what devices announce on the network (TVs, speakers, computers). Many devices, like smart plugs, don't announce one. Click any name to set your own.
- **Maker** comes from the first half of the MAC address. Phones and laptops often use a private, randomized address, shown as hidden. When a device on a private address switches to a new one and announces the same name, LANscape keeps it as the same device, with its name, settings and history, instead of listing it twice.
- **Online** means the device answered the latest scan. Phones and plugs that are asleep can briefly show as away.
- **New** marks devices you haven't acknowledged yet. Open a device and switch on **Known device**, or use **Mark all known**.
- **Click a device** to see its details and history (when it came online and went offline), and to set **Alert when offline**: LANscape alerts once when it has been quiet for 5, 10, 30 or 60 minutes, and once when it's back. Also set **Alert when online**: LANscape alerts each time it comes online after being away for 15 minutes, 30 minutes, 1 hour or 4 hours, like a phone arriving home. Shorter absences, like a phone dozing through a scan, don't count. Watched devices show a **Watched** badge.
- **Delete device** (in the same panel) removes a device with its name, settings and history. If it joins again, it's listed as new and sends a new-device alert. Useful for clearing out old entries, or to hear about a device the next time it shows up.
- **Export CSV** downloads the device list.

### How LANscape recognizes devices

Phones and laptops use a private, made-up MAC address for each Wi-Fi network, and some change it now and then. To keep a device's name, settings and history when its address changes, LANscape remembers what each device says about itself:

- **Stable IDs** that media and smart-home devices announce: Google Cast, AirPlay, HomeKit and UPnP ids, which don't change with the address.
- **What a device says when it joins** (its DHCP request): its hostname, its vendor class (like `android-dhcp-14`), and the list of settings it asks for, which tells the operating system and version apart. LANscape listens for these but doesn't answer them; your router does.
- **Its announced name**, as before.

A new private address is treated as a known device only when exactly one device that isn't answering fits, by stable ID first, then hostname plus DHCP fingerprint, then name; a different stable ID rules a device out. The same details give more devices a name (UPnP friendly names, DHCP hostnames) and a model: the **Model** column in the device list shows it, or the operating system a device's DHCP requests name (like Android 14 or Windows) when it announces no model. The full details are under **Identity** in the device's panel.

Listening for DHCP needs UDP port 67, so it stays off if another DHCP server runs on the same machine (such as Pi-hole's, if you turned it on).

### Identify a device

Not sure what `Espressif Inc. · 192.168.0.43` is? Click **Identify a device**:

1. Scan with the device on.
2. Turn it off (or unplug it) and scan again. Whatever went quiet is a candidate.
3. If more than one device went quiet, turn it back on and scan once more. Only the one that comes back is it.

Then name it right there.

## Services

**Services** watches the things on your network you rely on, like a NAS, Home Assistant or your Pi-hole. **Add service** and pick how to check it:

- **Web (HTTP):** an address like `http://192.168.0.10:8080`. It's up when it answers with a status below 400. Self-signed certificates are fine; LANscape only checks that it answers.
- **Port (TCP):** a host and port like `192.168.0.10:22`. It's up when the port accepts a connection.
- **DNS:** a DNS server's IP address, like your Pi-hole's, and a name to look up. It's up when that server can resolve the name.

Each service is checked every minute, 5 minutes or 15 minutes. One failed check shows as **Failing**; two in a row is **Down**, and LANscape alerts you, then again when it's back with how long it was down. Turn **Alert** off for a service you only want to see on the page. Each service shows its latest checks as a strip (green answered, red failed), its average answer time and its uptime over the last 24 hours. Results are kept for 90 days.

## Diagnostics

**Run a check** tests the path from the Umbrel to the internet, one link at a time, in a few seconds:

1. **This machine:** its network connection and which router it uses.
2. **Router:** whether the router answers pings.
3. **Internet (by address):** whether your internet host (1.1.1.1 by default) answers.
4. **DNS:** looking up a name through your own DNS servers, and through 1.1.1.1 for comparison.
5. **Secure web:** loading a small HTTPS page Google provides for connection checks.
6. **Route:** a traceroute to your internet host, hop by hop.

The line at the top names the first link that failed: inside your home network, past your router, DNS, or secure web. Routers along the way often ignore traceroute, so hops shown as `*` aren't a problem on their own. Nothing is saved; **Copy report** or **Download report** gives you plain text to send to your internet provider.

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

**Internet outage ends** (on by default) alerts once the internet is back after an outage, with how long it was down and whether your router answered. It can't alert during the outage, since the alert itself needs the internet.

**New device joins the network** alerts when a device LANscape has never seen appears. The very first scan only records what's already there. Devices that were asleep for it alert when they turn up, and several found in the same scan come as one alert.

**Unknown device is back** (off by default) alerts when a device you haven't marked as known comes back after an hour or more away, like a visitor's phone or something that only joins now and then. Mark your own devices as known on the Network page first, or you'll hear about them too.

### Reports

**Weekly summary** (off by default) sends a short report on the day and hour you pick, in your time zone, to every alert channel: this week against last for the health score, average speeds, ping and packet loss, outages, new devices and alerts. **Send a summary now** sends one straight away. Summaries also appear in Recent alerts.

**Download ISP report** gives a plain-text report of the last 30 days to send your internet provider: speed tests against your plan (enter your plan speeds on the Speed tests page, under Weekly pattern), how many tests came in under 80% of it, ping and packet loss, and every outage where your router kept answering but the internet didn't. Outages inside your home network are left out, since they aren't the provider's.

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

## Integrations

LANscape can use other apps on your network. Each has its own tab.

### Pi-hole

If you run [Pi-hole](https://pi-hole.net) (version 6 or later), connecting it gives LANscape:

- **Names** for devices that don't announce one. Your own names and announced names still come first.
- **A sign of life** for sleepy devices: a device that asked Pi-hole for something in the last 10 minutes counts as online, even if it slept through the scan. (Identify a device ignores this, so a device you just switched off isn't counted.)
- **DNS activity** in each device's panel on the Network page: how many requests it made, how many were blocked, and the domains it asks for most. It helps tell what a mystery device is.

To connect, create an app password in Pi-hole (Settings → Web interface / API → Configure app password), then enter it with Pi-hole's address on the Pi-hole tab. On Umbrel the address is `http://localhost:8082`. LANscape tests the connection before saving it.

Pi-hole only knows names if it hands out addresses itself (its DHCP server), or if **conditional forwarding** (Settings → DNS) points at your router. Without either, you still get the activity and the online signal.

### AI assistant

The **Assistant** page answers questions about your network in plain language: "When was my internet slow this month?", "Is there anything on my network I don't recognize?", "Has the NAS been flaky?". It reads the same data as the AI agents tab below (speed tests, latency, outages, devices, services and alerts) and can't change anything. Answers appear as they're written, with each piece of data it reads shown as it happens. Under each answer, **Looked at** shows exactly which data it read, so you can check it.

Set it up on the **AI assistant** tab with one of:

- **Claude:** an API key from console.anthropic.com. The model defaults to Claude Opus 5.5; any Claude model works.
- **OpenAI:** an API key from platform.openai.com and a model name.
- **Ollama or other:** any server with an OpenAI-compatible API, like Ollama on your own network (on Umbrel, usually `http://localhost:11434/v1`). The model needs to support tool calling.

LANscape tests the connection before saving it. The API key is never sent back to the browser.

**Where your data goes:** with Claude or OpenAI, your questions and the network data the assistant reads to answer them (speeds, outages, device names, IP and MAC addresses, service names and alerts) are sent to Anthropic or OpenAI. With a model on your own network, nothing leaves it. The page always says which applies. Nothing is sent until you ask, and conversations aren't stored: they stay in your browser tab until you close it or select **New chat**. Each data lookup appears in the AI agents tab's request log as "LANscape chat".

### AI agents (MCP)

AI agents that speak [MCP](https://modelcontextprotocol.io), like OpenClaw or Claude, can read LANscape's data, so you can ask them things like "was the internet slow last night?" or "what joined the network this week?". They get read-only tools for:

- a summary of the network right now, including the Internet Health Score
- speed test results and latency over time
- the device list and each device's online/offline history
- internet outages, and whether each was in your home network or past your router
- the services you watch, and whether each is up
- the alerts LANscape raised

Agents can't change settings, run scans or speed tests, or see Pi-hole's DNS activity. The tab has a few questions to start with, like "When was my internet slow this month, and was it my ISP or my home network?" or "Which devices never go offline?".

It's off until you select **Create token** on the AI agents tab. Copy the token straight away: LANscape keeps only a fingerprint and can't show it again. Then give the agent the server address (`http://<your-umbrel>:4545/mcp`, Streamable HTTP) with the token in an `Authorization: Bearer` header. The tab shows the exact command for Claude Code and a JSON config that most other clients accept. An agent running on the Umbrel itself also uses the Umbrel's network address, not `localhost`.

**Replace token** makes a new one and cuts off the old one; **Turn off** removes it. The tab lists the agents' recent requests, kept for 30 days. Backups leave the token out, and restoring one keeps the token you have now.

## Settings

- **Change password**, which signs out every other browser.
- **Sign out**, or **Sign out everywhere**.
- **Export data:** speed tests, ping checks and devices as CSV files.
- **Back up and restore**, below.

### Back up and restore

**Download backup** saves everything in one `.lanscape` file: history, devices and their names, rules, schedules and settings. Use it to move LANscape to another Umbrel, or to go back to it later.

The file includes your alert channels' secrets, like bot tokens and webhook addresses, your Pi-hole app password and your AI assistant's API key. Enter a passphrase before downloading to encrypt it. Keep the passphrase somewhere safe: an encrypted backup can't be restored without it.

To restore, choose the file (and its passphrase, if it has one) and select **Check backup**. LANscape checks the file and shows what's in it. **Replace current data with this backup** then swaps in the backup's data in one step: if anything goes wrong, nothing changes. A backup from an older version of LANscape is brought up to date as it's restored; one from a newer version asks you to update LANscape first.

Restoring keeps your current password and signed-in browsers. Just before it, LANscape saves the data it had, so **Undo last restore** can put it back. It keeps the last three of these copies in its data folder, under `backups`.

## Privacy

LANscape keeps everything on your Umbrel. It only reaches the internet for:

- speed tests (speedtest.net servers) and pings to your internet host
- alert channels you set up
- this help page, which your browser loads from GitHub

If you connect an AI agent over MCP, whatever it reads goes to that agent, and to its AI provider if it uses a cloud model. The built-in assistant sends your questions and the data it reads to Anthropic or OpenAI if you choose them, and nowhere if you use a model on your own network.

Speed test results include your public IP address; LANscape never stores it.

## Troubleshooting

- **The Telegram bot doesn't reply:** make sure you messaged the bot whose token you saved; the Telegram panel's **Find chat ID** names the right bot. The bot replies within a few seconds while LANscape is running.
- **A device keeps showing as away:** it's probably asleep. Phones and battery devices often skip scans.
- **A speed test fails right away:** check the Umbrel has internet access. The error appears under the button and on the Automations page.
- **Something else:** open an issue at [github.com/SuarezLuis/lanscape](https://github.com/SuarezLuis/lanscape/issues).

## Support LANscape

LANscape is free and open source. If it's useful to you, you can buy me a coffee, here or with **Buy me a coffee** at the bottom of the sidebar:

[![Buy me a coffee](https://raw.githubusercontent.com/SuarezLuis/lanscape/master/docs/assets/buy-me-a-coffee.svg)](https://www.buymeacoffee.com/suarezluis)
