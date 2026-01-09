import { sendEmail } from "./connectMailer";

const semesterMapping: Record<string, string> = {
  "02": "Spring",
  "05": "Summer",
  "08": "Fall",
};

const termToString = (term: string): string => {
  if (term.length !== 6) return "Unknown";
  const semester = semesterMapping[term.slice(4)];
  if (!semester) return "Unknown";
  const year = term.slice(0, 4);
  return `${semester} ${year}`;
};

interface SendInvitationParameters {
  inviteId: string;
  senderEmail: string;
  friendEmail: string;
  term: string;
  versionNames: string[];
  url?: string;
}

export default async function sendInvitation({
  inviteId,
  senderEmail,
  friendEmail,
  term,
  versionNames,
  url,
}: SendInvitationParameters): Promise<void> {
  const inviteUrl = url + `/#/invite/${inviteId}`;
  const semester = termToString(term);
  const subject = "Friend Schedule Invite";
  const text = `
  You have been invited to a GT schedule by ${senderEmail}
  \tSemester: ${semester}
  \tVersion: ${versionNames.join(", ")}
  Accept the invite: ${inviteUrl}
  `;
  const html = `
  <div style="width: 600px">
    <div
      class="header"
      style="
        background-image: linear-gradient(to right, #ff5b54, #ffba4e);
        height: 88px;
        font-weight: bold;
        color: white;
        font-size: 48px;
        padding-left: 11px;
        padding-top: 10px;
      "
    >
      GT Scheduler
    </div>
    <div class="body-text" style="background-color: #222222; padding: 20px">
      <h1 style="color: white; font-size: 24px">Invitation to View Schedule</h1>
      <p style="color: white">Hello,</p>
      <p style="color: white">
        You have been invited by
        <span style="text-decoration: underline">
          <a
            href="mailto:${senderEmail}"
            style="color: white; text-decoration: none"
            class="sender-email"
          >
            <b>${senderEmail}</b></a
          >
        </span>
        to import the following schedules: <b>${versionNames.join(", ")}</b> for
        the ${semester} semester. Accepting this invite allows you to compare this
        schedule to others in you Shared Schedule panel when turned on. You can
        always remove this schedule from your view in the site after importing it
        if you chose to do so.
      </p>
      <a
        href="${inviteUrl}"
        style="color: white; text-decoration: none; width: 100%"
      >
        <div
          style="
            background: #fe5b53;
            border-radius: 8px;
            padding: 10px;
            text-align: center;
          "
        >
          <b> Accept Invite</b>
        </div>
      </a>
      <p style="color: white">
        For any inquiries, please contact us at
        <a
          href="mailto:contact@gt-scheduler.org"
          style="color: #fe5b53; text-decoration: none"
          >contact@gt-scheduler.org</a
        >
      </p>
      <p style="color: white">The GT Scheduler Team @<b>Bits of Good</b></p>
      <div
        style="
          display: flex;
          flex-direction: row;
          justify-content: center;
          align-items: center;
          color: white;
          font-size: 24px;
        "
      >
        <img
          src="https://firebasestorage.googleapis.com/v0/b/gt-scheduler-web-prod.appspot.com/o/bogLogo.png?alt=media&token=cda9f3c3-8c90-460c-8a6a-36d02f542066"
          alt="Bog Logo"
          style="width: 28px; height: 30px"
        />
        <p>bits of good</p>
      </div>
    </div>
  </div>


  `;
  await sendEmail(friendEmail, subject, text, html);
}
