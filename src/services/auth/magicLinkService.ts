import crypto from 'crypto';
import { Resend } from 'resend';
import { MagicLink } from '../../models/MagicLink';


export function generateMagicToken(){
    const token = crypto.randomBytes(32).toString("hex");
    const hash = crypto.createHash("sha256").update(token).digest("hex");

    return { token, hash};
}

export async function sendMagicLink(email: string, pseudo: string){
    console.log('sendMagicLink called for:', email);

    const { token, hash} = generateMagicToken();

    const magicLinkRecord = await MagicLink.create({
        tokenHash: hash,
        email,
        pseudo,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        used: false,
    });
    console.log('🔵 MagicLink record created:', magicLinkRecord._id);

    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
        throw new Error('RESEND_API_KEY is not configured in environment');
    }

    const resend = new Resend(apiKey);
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:5000';
    console.log('🔵 Backend URL:', backendUrl);

    try {
        const result = await resend.emails.send({
            from: process.env.EMAIL_FROM || "Stealf <noreply@stealf.xyz>",
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
        console.log('Email sent successfully to:', email);
    } catch (emailError) {
        console.error('Failed to send email:', emailError);
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