import nodemailer from "nodemailer";

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.EMAIL_FROM?.trim() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASS?.trim(),
  );
}

function getTransport() {
  if (!smtpConfigured()) {
    throw new Error(
      "Email is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and EMAIL_FROM.",
    );
  }

  const port = Number(process.env.SMTP_PORT ?? "587");
  const secure =
    process.env.SMTP_SECURE === "true" ||
    process.env.SMTP_SECURE === "1" ||
    port === 465;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number.isFinite(port) ? port : 587,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendAuthCodeEmail(input: {
  to: string;
  purpose: "verify_email" | "reset_password";
  code: string;
}) {
  const transport = getTransport();
  const isVerify = input.purpose === "verify_email";
  const subject = isVerify
    ? "Verify your email"
    : "Reset your password";
  const heading = isVerify
    ? "Verify your email"
    : "Password reset code";
  const intro = isVerify
    ? "Use this code to verify your Google Docs Clone account."
    : "Use this code to reset your Google Docs Clone password.";

  const text = [
    heading,
    "",
    intro,
    "",
    `Your code: ${input.code}`,
    "",
    "This code expires in 10 minutes.",
    "If you did not request this, you can ignore this email.",
  ].join("\n");

  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#18181b">
      <h1 style="font-size:20px;margin:0 0 12px">${heading}</h1>
      <p style="margin:0 0 16px">${intro}</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:0.2em;margin:0 0 16px">${input.code}</p>
      <p style="margin:0;color:#52525b;font-size:14px">This code expires in 10 minutes. If you did not request this, you can ignore this email.</p>
    </div>
  `;

  await transport.sendMail({
    from: process.env.EMAIL_FROM,
    to: input.to,
    subject,
    text,
    html,
  });
}
