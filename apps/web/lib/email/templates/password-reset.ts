// Plain inline-styled HTML template (no template engine dependency, matching
// the rest of this app's zero-new-deps-where-possible posture).

export function passwordResetEmailHtml(opts: {
  resetUrl: string;
  expiresInMinutes: number;
}): string {
  const { resetUrl, expiresInMinutes } = opts;
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background:#1d4ed8;padding:24px 32px;">
                <span style="color:#ffffff;font-size:18px;font-weight:600;letter-spacing:0.02em;">PIKORUA HRM</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;color:#111827;">
                <h1 style="margin:0 0 16px;font-size:20px;">Reset your password</h1>
                <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#374151;">
                  We received a request to reset the password on your Pikorua HRM account.
                  This link expires in <strong>${expiresInMinutes} minutes</strong>. If you
                  didn't request this, you can safely ignore this email.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:6px;background:#1d4ed8;">
                      <a href="${resetUrl}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">
                        Reset password
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#6b7280;">
                  If the button doesn't work, copy and paste this link into your browser:<br />
                  <a href="${resetUrl}" style="color:#1d4ed8;word-break:break-all;">${resetUrl}</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
