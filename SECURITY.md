# Security

Ormma holds private things — people's birthdays and phone numbers, your calendar and diary — and a live WhatsApp session. Thank you for helping keep them safe.

## Reporting a vulnerability

Please report it privately, not in a public issue: on GitHub, open the repository's **Security** tab and choose **Report a vulnerability**. Say what you found, how to reproduce it, and what it lets someone do. You will hear back within a week; once it is fixed and released, we will credit you in the release notes, if you would like.

Only the latest release is supported: fixes go into the next one.

## What Ormma does to stay safe

- The app and its WhatsApp bridge listen on `127.0.0.1` only (in Docker, the compose network is the fence). Every call to the bridge but `/healthz` needs its token.
- One password, kept as a salted scrypt hash; a signed session cookie; wrong passwords throttled; form posts only from Ormma's own pages; a Content-Security-Policy with no inline script and nothing from other sites.
- The desktop app's first-run page — where the password is chosen — answers only on this computer, only to a Host of `localhost`, and only to forms from itself.
- The bridge ignores messages from strangers, reads only the chats you tick, messages only numbers that are on WhatsApp, and sends at most 30 direct messages an hour.

## Not a vulnerability

- **That WhatsApp may ban a number linked to Ormma.** Ormma sends through an unofficial client, which is against WhatsApp's Terms of Service: [the README says so](README.md#a-word-about-whatsapp), and recommends a spare number.
- **That someone at your computer can use Ormma.** It is a personal app on a personal computer: anyone who can sign in to the computer as you can reset its password, as with the rest of your files.
- **That the downloads are not yet signed.** [The install guide](docs/install.md#the-desktop-app) says how to check them against their published SHA-256 sums.
