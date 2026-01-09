import * as nodemailer from "nodemailer";

export interface SendMailInfo {
  envelope: string;
  messageId: string;
}

export default async function connectMailer(): Promise<nodemailer.Transporter> {
  return nodemailer.createTransport({
    host: process.env.NODEMAILER_HOST ?? "",
    port: process.env.NODEMAILER_PORT ?? "",
    secure: true,
    auth: {
      user: process.env.NODEMAILER_USERNAME ?? "",
      pass: process.env.NODEMAILER_PASSWORD ?? "",
    },
    tls: {
      rejectUnauthorized: false,
    },
  } as nodemailer.TransportOptions);
}

export async function sendEmail(
  email: string,
  subject: string,
  text: string,
  html: string
): Promise<SendMailInfo> {
  const transporter = await connectMailer();
  const info: SendMailInfo = await transporter.sendMail({
    from: process.env.NODEMAILER_EMAIL, // sender address
    to: email, // list of receivers
    subject, // Subject line
    text, // plain text body
    html, // html body
  });
  return info;
}
