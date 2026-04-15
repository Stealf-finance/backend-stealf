import csv
import smtplib
import time
import sys
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# ============ CONFIG ============
GMAIL_ADDRESS = ""               # Workspace required for 2000/day
GMAIL_APP_PASSWORD = "."       # App Password
CSV_PATH = "./beta-codes.csv"
SENT_LOG = "./sent-beta.log"
DELAY_SECONDS = 1.5
LIMIT = 1000

SUBJECT = "Your Closed Beta Access Code"
FROM_NAME = "Stealf"

IOS_LINK = "https://testflight.apple.com/join/TXbFmeER"

# TEST MODE (None = envoi réel à tout le monde)
TEST_ONLY = None  # "louisspaccesi@gmail.com" pour tester


def build_html(code: str) -> str:
    return f"""\
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="color-scheme" content="dark">
</head>
<body bgcolor="#000000" style="margin:0;padding:0;background:#000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#000000">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#000000" style="max-width:480px;">
        <tr><td align="center" style="padding:0 0 32px 0;">
          <img src="https://stealf.xyz/logo-transparent.png" alt="Stealf" width="128" height="128" style="display:block;opacity:0.9;" />
        </td></tr>
        <tr><td align="center" style="padding:0 0 28px 0;">
          <h1 style="margin:0;color:#fff;font-size:40px;font-weight:200;letter-spacing:6px;text-transform:uppercase;">CLOSED BETA<br/>ACCESS</h1>
        </td></tr>
        <tr><td style="padding:0 0 40px 0;"><div style="height:1px;background:#222;"></div></td></tr>
        <tr><td style="padding:0 0 24px 0;">
          <p style="margin:0;color:#eee;font-size:18px;line-height:1.8;">Your code for the closed beta access:</p>
        </td></tr>
        <tr><td align="center" style="padding:0 0 24px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="border:1px solid #333;border-radius:12px;">
            <tr><td style="padding:20px 40px;background:#0a0a0a;border-radius:12px;">
              <p style="margin:0;color:#fff;font-size:28px;font-weight:700;letter-spacing:4px;font-family:'Courier New',monospace;">{code}</p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 0 32px 0;">
          <p style="margin:0 0 20px 0;color:#999;font-size:14px;line-height:2;">This beta-testing is only on <strong style="color:#ddd;">devnet</strong> for the moment. Don't hesitate to share feedback.</p>
          <p style="margin:0 0 20px 0;color:#999;font-size:14px;line-height:2;">The <strong style="color:#ddd;">Android version</strong> is coming soon. Stay tuned.</p>
          <p style="margin:0;color:#999;font-size:14px;line-height:2;">Thanks for your trust and <strong style="color:#ddd;">stay stealf.</strong></p>
        </td></tr>
        <tr><td style="padding:0 0 32px 0;"><div style="height:1px;background:#222;"></div></td></tr>
        <tr><td style="padding:0 0 20px 0;">
          <p style="margin:0;color:#eee;font-size:16px;text-align:center;">Download the app</p>
        </td></tr>
        <tr><td align="center" style="padding:0 0 40px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="padding:0 6px;">
              <a href="{IOS_LINK}" target="_blank" style="display:inline-block;padding:14px 28px;background:#fff;color:#000;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">iOS (TestFlight)</a>
            </td>
            <td style="padding:0 6px;">
              <span style="display:inline-block;padding:14px 28px;background:#0a0a0a;color:#666;font-size:14px;font-weight:600;border:1px solid #222;border-radius:8px;">Android — Coming soon</span>
            </td>
          </tr></table>
        </td></tr>
        <tr><td align="center" style="padding:0 0 8px 0;">
          <img src="https://stealf.xyz/logo-transparent.png" alt="" width="16" height="16" style="display:inline-block;opacity:0.1;" />
        </td></tr>
        <tr><td align="center">
          <p style="margin:0;color:#222;font-size:11px;letter-spacing:2px;">&copy; 2026 STEALF</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""


def load_codes() -> dict:
    mapping = {}
    with open(CSV_PATH, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            email = row["email"].strip().lower()
            code = row["code"].strip()
            if email and "@" in email and code:
                mapping[email] = code
    return mapping


def load_sent() -> set:
    if not os.path.exists(SENT_LOG):
        return set()
    with open(SENT_LOG) as f:
        return {line.strip() for line in f if line.strip()}


def log_sent(email: str):
    with open(SENT_LOG, "a") as f:
        f.write(email + "\n")


def send_email(smtp, to_address: str, code: str):
    msg = MIMEMultipart("alternative")
    msg["From"] = f"{FROM_NAME} <{GMAIL_ADDRESS}>"
    msg["To"] = to_address
    msg["Subject"] = SUBJECT
    msg.attach(MIMEText(build_html(code), "html"))
    smtp.sendmail(GMAIL_ADDRESS, to_address, msg.as_string())


def main():
    all_codes = load_codes()
    print(f"Loaded {len(all_codes)} email/code pairs from CSV")

    if TEST_ONLY:
        targets = {TEST_ONLY: all_codes.get(TEST_ONLY, "BETA-TEST0000")}
        print(f"\n** TEST MODE: only {TEST_ONLY} **\n")
    else:
        already = load_sent()
        remaining = [(e, c) for e, c in all_codes.items() if e not in already]
        targets = dict(remaining[:LIMIT])
        print(f"Déjà envoyés: {len(already)} | Restants à envoyer: {len(targets)}\n")

    if not targets:
        print("Rien à envoyer.")
        return

    if not TEST_ONLY:
        confirm = input(f"Envoyer à {len(targets)} destinataires ? (oui/non): ")
        if confirm.lower() not in ("oui", "o", "yes", "y"):
            print("Annulé.")
            sys.exit(0)

    sent, failed = 0, []
    with smtplib.SMTP_SSL("smtp.hostinger.com", 465) as smtp:
        smtp.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
        print("Connecté à Hostinger SMTP.\n")

        for i, (email, code) in enumerate(targets.items(), 1):
            try:
                send_email(smtp, email, code)
                if not TEST_ONLY:
                    log_sent(email)
                sent += 1
                print(f"[{i}/{len(targets)}] OK   -> {email} ({code})")
            except Exception as e:
                failed.append((email, str(e)))
                print(f"[{i}/{len(targets)}] FAIL -> {email} ({e})")
                if "550" in str(e) or "quota" in str(e).lower() or "5.4.5" in str(e):
                    print("\n!! Limite Gmail atteinte — relance demain.")
                    break
            if i < len(targets):
                time.sleep(DELAY_SECONDS)

    print(f"\nTerminé: {sent} envoyés, {len(failed)} échoués.")
    if failed:
        print("\nÉchecs (10 premiers):")
        for e, err in failed[:10]:
            print(f"  - {e}: {err}")


if __name__ == "__main__":
    main()
