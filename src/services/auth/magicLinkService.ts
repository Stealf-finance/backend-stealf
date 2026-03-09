import crypto from 'crypto';
import { Resend } from 'resend';
import { MagicLink } from '../../models/MagicLink';
import logger from '../../config/logger';


export function generateMagicToken(){
    const token = crypto.randomBytes(32).toString("hex");
    const hash = crypto.createHash("sha256").update(token).digest("hex");

    return { token, hash};
}

export async function sendMagicLink(email: string, pseudo: string){
    logger.debug('sendMagicLink called');

    const { token, hash} = generateMagicToken();

    const magicLinkRecord = await MagicLink.create({
        tokenHash: hash,
        email,
        pseudo,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        used: false,
    });
    logger.debug({ recordId: magicLinkRecord._id }, 'MagicLink record created');

    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
        throw new Error('RESEND_API_KEY is not configured in environment');
    }

    const resend = new Resend(apiKey);
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:5000';
    logger.debug({ backendUrl }, 'Backend URL for magic link');

    try {
        const result = await resend.emails.send({
            from: "Stealf <noreply@support.stealf.xyz>",
            to: email,
            subject: "Verify your email - Stealf",
            html: `
            <p>Hi ${pseudo},</p>
            <p>Click the link below to verify your email:</p>
            <a href="${backendUrl}/api/users/verify-magic-link?token=${token}">
                Verify email
            </a>
            <p>This link expires in 10 minutes.</p>
            <p>If you didn't request this, please ignore this email.</p>
            `
        });
        logger.info('Magic link email sent successfully');
    } catch (emailError) {
        logger.error({ err: emailError }, 'Failed to send magic link email');
        throw emailError;
    }

}

export async function verifyMagicLink(token: string): Promise<{ email: string; pseudo: string }> {

    const tokenHash = crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");

    const record = await MagicLink.findOne({ tokenHash });

    if (!record) throw new Error("Invalid token");
    if (record.used) throw new Error("Token already used");
    if (record.expiresAt < new Date()) throw new Error("Token expired");

    await MagicLink.updateOne(
        { _id: record._id },
        { used: true }
    );

    return {
        email: record.email,
        pseudo: record.pseudo,
    };
}
