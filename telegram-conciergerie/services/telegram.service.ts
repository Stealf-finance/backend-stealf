import 'dotenv/config';
import { Telegraf, Context, Markup } from 'telegraf';
import { Update } from 'telegraf/typings/core/types/typegram';

// Configuration
const BOT_TOKEN = process.env.BOT_TOKEN || 'TON_TOKEN_ICI';
const ADMIN_CHANNEL_ID = process.env.ADMIN_CHANNEL_ID || '';

const bot = new Telegraf(BOT_TOKEN);

// Interface pour les tickets
interface Ticket {
  id: string;
  userId: number;
  username: string;
  message: string;
  status: 'envoyé' | 'en_cours' | 'traité';
  createdAt: Date;
}

// Stockage des tickets en mémoire (utiliser une base de données en production)
const tickets = new Map<string, Ticket>();
const userStates = new Map<number, 'awaiting_message' | 'in_conversation'>();
const adminConversations = new Map<number, number>(); // adminId -> userId en conversation

// Générer un ID unique pour les tickets
function generateTicketId(): string {
  return `TICKET-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}


// Command /start
bot.start((ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  userStates.set(userId, 'awaiting_message');
  ctx.reply(
    'Welcome to Stealf concierge service! \n\n' +
    'Please describe your request in detail. Please provide your name and email.\n' +
    'Our team will handle your ticket as soon as possible.'
  );
});

// Command to end a conversation
bot.command('endconvo', async (ctx) => {
  const adminId = ctx.from?.id;
  if (!adminId) return;

  const userId = adminConversations.get(adminId);
  if (!userId) {
    await ctx.reply('No active conversation.');
    return;
  }

  adminConversations.delete(adminId);
  userStates.delete(userId);

  await ctx.reply('✅ Conversation ended.');
  await ctx.telegram.sendMessage(
    userId,
    '✅ The conversation with support has ended.\n\n' +
    'You can create a new ticket with /start if needed.'
  );
});

// Command to broadcast message to admin channel (admin only)
bot.command('broadcast', async (ctx) => {
  if (!ADMIN_CHANNEL_ID) {
    await ctx.reply('Admin channel not configured.');
    return;
  }

  const message = ctx.message.text.replace('/broadcast', '').trim();
  if (!message) {
    await ctx.reply('Usage: /broadcast Your message here');
    return;
  }

  try {
    await ctx.telegram.sendMessage(ADMIN_CHANNEL_ID, message);
    await ctx.reply('✅ Message sent to admin channel');
  } catch (error) {
    await ctx.reply('❌ Error sending message');
    console.error('Broadcast error:', error);
  }
});

// Handle text messages
bot.on('text', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Ignore commands - they are handled separately
  if (ctx.message.text.startsWith('/')) {
    return;
  }

  // Check if it's an admin in conversation
  const targetUserId = adminConversations.get(userId);
  if (targetUserId) {
    // Admin sends a message to a user
    const username = ctx.from.username || ctx.from.first_name || 'Admin';
    await ctx.telegram.sendMessage(
      targetUserId,
      `💬 Stealf Support:\n${ctx.message.text}`
    );
    await ctx.reply('✅ Message sent to user');
    return;
  }

  // Check if user is in conversation with an admin
  if (userStates.get(userId) === 'in_conversation') {
    // Find the admin in conversation with this user
    const adminId = Array.from(adminConversations.entries())
      .find(([_, uId]) => uId === userId)?.[0];

    if (adminId) {
      const username = ctx.from.username || ctx.from.first_name || 'User';
      await ctx.telegram.sendMessage(
        adminId,
        `💬 @${username}:\n${ctx.message.text}`
      );
      return;
    }
  }

  // If user is waiting for message after /start
  if (userStates.get(userId) === 'awaiting_message') {
    const ticketId = generateTicketId();
    const username = ctx.from.username || `${ctx.from.first_name || 'User'} ${ctx.from.last_name || ''}`;

    const ticket: Ticket = {
      id: ticketId,
      userId: userId,
      username: username,
      message: ctx.message.text,
      status: 'envoyé',
      createdAt: new Date()
    };

    tickets.set(ticketId, ticket);
    userStates.delete(userId);

    // Send confirmation to user
    await ctx.reply(
      `✅ Your ticket has been created successfully!\n\n` +
      `Ticket number: ${ticketId}\n` +
      `Status: Pending\n\n` +
      `We will contact you as soon as possible.`
    );

    // Send ticket to admin channel
    if (ADMIN_CHANNEL_ID) {
      try {
        await ctx.telegram.sendMessage(
          ADMIN_CHANNEL_ID,
          `🎫 NEW TICKET\n\n` +
          `ID: ${ticketId}\n` +
          `From: @${username} (ID: ${userId})\n` +
          `Date: ${ticket.createdAt.toLocaleString('en-US')}\n` +
          `Status: ${ticket.status}\n\n` +
          `Message:\n${ticket.message}`,
          Markup.inlineKeyboard([
            [
              Markup.button.callback('📨 Sent', `status_envoyé_${ticketId}`),
              Markup.button.callback('⏳ In Progress', `status_en_cours_${ticketId}`),
              Markup.button.callback('✅ Resolved', `status_traité_${ticketId}`)
            ],
            [
              Markup.button.callback('💬 Contact User', `contact_${ticketId}`)
            ]
          ])
        );
      } catch (error) {
        console.error('Error sending to admin channel:', error);
      }
    }
  } else {
    // Message out of context
    ctx.reply(
      'To create a new ticket, use the /start command'
    );
  }
});

// Handle inline button callbacks
bot.action(/status_(envoyé|en_cours|traité)_(.+)/, async (ctx) => {
  const match = ctx.match;
  const newStatus = match[1] as 'envoyé' | 'en_cours' | 'traité';
  const ticketId = match[2];

  const ticket = tickets.get(ticketId);
  if (!ticket) {
    await ctx.answerCbQuery('Ticket not found');
    return;
  }

  // Update status
  ticket.status = newStatus;

  const statusEmoji = {
    'envoyé': '📨',
    'en_cours': '⏳',
    'traité': '✅'
  };

  const statusLabel = {
    'envoyé': 'SENT',
    'en_cours': 'IN PROGRESS',
    'traité': 'RESOLVED'
  };

  // Update message with new status
  await ctx.editMessageText(
    `🎫 TICKET\n\n` +
    `ID: ${ticketId}\n` +
    `From: @${ticket.username} (ID: ${ticket.userId})\n` +
    `Date: ${ticket.createdAt.toLocaleString('en-US')}\n` +
    `Status: ${statusEmoji[newStatus]} ${statusLabel[newStatus]}\n\n` +
    `Message:\n${ticket.message}`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('📨 Sent', `status_envoyé_${ticketId}`),
        Markup.button.callback('⏳ In Progress', `status_en_cours_${ticketId}`),
        Markup.button.callback('✅ Resolved', `status_traité_${ticketId}`)
      ],
      [
        Markup.button.callback('💬 Contact User', `contact_${ticketId}`)
      ]
    ])
  );

  await ctx.answerCbQuery(`Status updated: ${statusLabel[newStatus]}`);

  // Notify user of status change
  try {
    let statusMessage = '';
    if (newStatus === 'en_cours') {
      statusMessage = `⏳ Your ticket ${ticketId} is now being processed.`;
    } else if (newStatus === 'traité') {
      statusMessage = `✅ Your ticket ${ticketId} has been resolved successfully!\n\nThank you for your trust.`;
    }

    if (statusMessage) {
      await ctx.telegram.sendMessage(ticket.userId, statusMessage);
    }
  } catch (error) {
    console.error('Error notifying user:', error);
  }
});

// Handle "Contact User" button
bot.action(/contact_(.+)/, async (ctx) => {
  const ticketId = ctx.match[1];
  const ticket = tickets.get(ticketId);

  if (!ticket) {
    await ctx.answerCbQuery('Ticket not found');
    return;
  }

  const adminId = ctx.from?.id;
  if (!adminId) {
    await ctx.answerCbQuery('Error: Admin ID not found');
    return;
  }

  // Put admin and user in conversation mode
  adminConversations.set(adminId, ticket.userId);
  userStates.set(ticket.userId, 'in_conversation');

  await ctx.answerCbQuery('Conversation mode activated! Check your private messages with the bot.');

  // Send message to admin
  try {
    await ctx.telegram.sendMessage(
      adminId,
      `💬 Conversation started with @${ticket.username}\n` +
      `📋 Ticket: ${ticketId}\n` +
      `📝 Original message: "${ticket.message}"\n\n` +
      `All your next messages here will be sent to this user.\n` +
      `To end the conversation, use /endconvo`
    );
  } catch (error) {
    // If bot can't message the admin, provide a deeplink
    await ctx.answerCbQuery(
      '⚠️ Please start a private conversation with the bot first! Click here to start.',
      { url: `https://t.me/${ctx.botInfo.username}?start=contact_${ticketId}` }
    );
    return;
  }

  // Notify user
  await ctx.telegram.sendMessage(
    ticket.userId,
    `💬 A Stealf support agent is now online with you regarding your ticket ${ticketId}.\n\n` +
    `You can chat directly here.`
  );
});

// Error handling
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}`, err);
  ctx.reply('An error occurred. Please try again.');
});

// Export initialization function
export function initTelegramBot() {
  bot.launch()
    .then(() => console.log('🤖 Telegram Bot started successfully!'))
    .catch((err) => console.error('Telegram Bot startup error:', err));

  // Graceful shutdown
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

export default bot;
