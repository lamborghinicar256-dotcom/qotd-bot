require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Events,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const requests = new Map();

const qotdCommand = new SlashCommandBuilder()
  .setName('qotd-request')
  .setDescription('Submit a QOTD request for leadership review')
  .addStringOption(option =>
    option
      .setName('question')
      .setDescription('The QOTD you want to host')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('date')
      .setDescription('The date you want to host it')
      .setRequired(true)
  );

const eventCommand = new SlashCommandBuilder()
  .setName('event-request')
  .setDescription('Start an event request');

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: [qotdCommand.toJSON(), eventCommand.toJSON()] }
  );

  console.log('Slash commands registered.');
}

function buildActiveButtons(requestId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve_${requestId}`)
      .setLabel('Approve')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`deny_${requestId}`)
      .setLabel('Deny')
      .setStyle(ButtonStyle.Danger)
  );
}

function buildDisabledButtons(requestId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve_${requestId}`)
      .setLabel('Approve')
      .setStyle(ButtonStyle.Success)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`deny_${requestId}`)
      .setLabel('Deny')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true)
  );
}

function buildQotdPendingEmbed(userId, question, date) {
  return new EmbedBuilder()
    .setTitle('New QOTD Request')
    .addFields(
      { name: 'Requested by', value: `<@${userId}>`, inline: true },
      { name: 'Requested date', value: date, inline: true },
      { name: 'Status', value: 'Pending Review', inline: true },
      { name: 'Question', value: question }
    )
    .setTimestamp();
}

function buildQotdReviewedEmbed(userId, question, date, statusText, reason = null) {
  const embed = new EmbedBuilder()
    .setTitle('QOTD Request Reviewed')
    .addFields(
      { name: 'Requested by', value: `<@${userId}>`, inline: true },
      { name: 'Requested date', value: date, inline: true },
      { name: 'Status', value: statusText, inline: true },
      { name: 'Question', value: question }
    )
    .setTimestamp();

  if (reason) {
    embed.addFields({ name: 'Reason', value: reason });
  }

  return embed;
}

function buildEventPendingEmbed(userId, platform, name, start, end, prize, description) {
  return new EmbedBuilder()
    .setTitle('New Event Request')
    .addFields(
      { name: 'Requested by', value: `<@${userId}>`, inline: true },
      { name: 'Event type', value: platform, inline: true },
      { name: 'Event name', value: name, inline: true },
      { name: 'Start', value: start, inline: true },
      { name: 'End', value: end, inline: true },
      { name: 'Prize', value: prize, inline: true },
      { name: 'Status', value: 'Pending Review', inline: true },
      { name: 'Description', value: description }
    )
    .setTimestamp();
}

function buildEventReviewedEmbed(userId, platform, name, start, end, prize, description, statusText, reason = null) {
  const embed = new EmbedBuilder()
    .setTitle('Event Request Reviewed')
    .addFields(
      { name: 'Requested by', value: `<@${userId}>`, inline: true },
      { name: 'Event type', value: platform, inline: true },
      { name: 'Event name', value: name, inline: true },
      { name: 'Start', value: start, inline: true },
      { name: 'End', value: end, inline: true },
      { name: 'Prize', value: prize, inline: true },
      { name: 'Status', value: statusText, inline: true },
      { name: 'Description', value: description }
    )
    .setTimestamp();

  if (reason) {
    embed.addFields({ name: 'Reason', value: reason });
  }

  return embed;
}

function buildDecisionDmEmbed(title, result, reviewedById, fields, reason = null) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .addFields(
      { name: 'Result', value: `**${result}**`, inline: true },
      { name: 'Reviewed by', value: `<@${reviewedById}>`, inline: true },
      ...fields
    )
    .setTimestamp();

  if (reason) {
    embed.addFields({ name: 'Reason', value: reason });
  }

  return embed;
}

async function editReviewMessage(requestData, embed) {
  const reviewChannel = await client.channels.fetch(requestData.reviewChannelId).catch(() => null);
  if (!reviewChannel) return;

  const reviewMessage = await reviewChannel.messages.fetch(requestData.reviewMessageId).catch(() => null);
  if (!reviewMessage) return;

  await reviewMessage.edit({
    embeds: [embed],
    components: [buildDisabledButtons(requestData.id)],
  });
}

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'qotd-request') {
        const question = interaction.options.getString('question');
        const date = interaction.options.getString('date');

        const reviewChannel = await client.channels.fetch(process.env.REVIEW_CHANNEL_ID).catch(() => null);

        if (!reviewChannel) {
          return interaction.reply({
            content: 'QOTD review channel not found.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const requestId = interaction.id;

        const reviewMessage = await reviewChannel.send({
          embeds: [buildQotdPendingEmbed(interaction.user.id, question, date)],
          components: [buildActiveButtons(requestId)],
        });

        requests.set(requestId, {
          id: requestId,
          type: 'qotd',
          requesterId: interaction.user.id,
          question,
          date,
          reviewChannelId: process.env.REVIEW_CHANNEL_ID,
          reviewMessageId: reviewMessage.id,
          status: 'pending',
        });

        return interaction.reply({
          content: 'Your QOTD request was submitted for review.',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (interaction.commandName === 'event-request') {
        const select = new StringSelectMenuBuilder()
          .setCustomId('event_type_select')
          .setPlaceholder('Choose what kind of event you want to request')
          .addOptions(
            {
              label: 'Roblox Event',
              value: 'roblox',
              description: 'Request a Roblox-hosted event',
            },
            {
              label: 'Discord Event',
              value: 'discord',
              description: 'Request a Discord-hosted event',
            }
          );

        const row = new ActionRowBuilder().addComponents(select);

        return interaction.reply({
          content: 'Pick the type of event you want to request.',
          components: [row],
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'event_type_select') {
        const platform = interaction.values[0] === 'roblox' ? 'Roblox Event' : 'Discord Event';

        const modal = new ModalBuilder()
          .setCustomId(`eventModal_${interaction.values[0]}`)
          .setTitle(platform);

        const nameInput = new TextInputBuilder()
          .setCustomId('eventName')
          .setLabel('Event name')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const startInput = new TextInputBuilder()
          .setCustomId('eventStart')
          .setLabel('Start date / time')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Example: April 25, 2026 at 7:00 PM EST')
          .setRequired(true);

        const endInput = new TextInputBuilder()
          .setCustomId('eventEnd')
          .setLabel('End date / time')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Example: April 25, 2026 at 8:00 PM EST')
          .setRequired(true);

        const prizeInput = new TextInputBuilder()
          .setCustomId('eventPrize')
          .setLabel('Prize')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Example: Nitro / Robux / Role')
          .setRequired(true);

        const descriptionInput = new TextInputBuilder()
          .setCustomId('eventDescription')
          .setLabel('Description')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(nameInput),
          new ActionRowBuilder().addComponents(startInput),
          new ActionRowBuilder().addComponents(endInput),
          new ActionRowBuilder().addComponents(prizeInput),
          new ActionRowBuilder().addComponents(descriptionInput)
        );

        return interaction.showModal(modal);
      }
    }

    if (interaction.isButton()) {
      const member = interaction.member;
      const requiredRole = process.env.PR_LEADERSHIP_ROLE_ID;

      if (!member.roles.cache.has(requiredRole)) {
        return interaction.reply({
          content: 'You are not allowed to review requests.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const [action, requestId] = interaction.customId.split('_');
      const requestData = requests.get(requestId);

      if (!requestData) {
        return interaction.reply({
          content: 'That request could not be found.',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (requestData.status !== 'pending') {
        return interaction.reply({
          content: 'This request has already been reviewed.',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (action === 'approve') {
        requestData.status = 'approved';
        requestData.reviewerId = interaction.user.id;
        requests.set(requestId, requestData);

        if (requestData.type === 'qotd') {
          const approvedChannel = await client.channels
            .fetch(process.env.APPROVED_QOTD_CHANNEL_ID)
            .catch(() => null);

          if (approvedChannel) {
            const approvedEmbed = new EmbedBuilder()
              .setTitle('Approved QOTD')
              .addFields(
                { name: 'Question', value: requestData.question },
                { name: 'Requested date', value: requestData.date, inline: true },
                { name: 'Approved by', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Original requester', value: `<@${requestData.requesterId}>`, inline: true }
              )
              .setTimestamp();

            await approvedChannel.send({ embeds: [approvedEmbed] });
          }

          const requester = await client.users.fetch(requestData.requesterId).catch(() => null);
          if (requester) {
            const dmEmbed = buildDecisionDmEmbed(
              'QOTD Request Update',
              'Approved',
              interaction.user.id,
              [
                { name: 'Question', value: requestData.question },
                { name: 'Date', value: requestData.date, inline: true },
              ]
            );

            await requester.send({ embeds: [dmEmbed] }).catch(() => null);
          }

          return interaction.update({
            embeds: [
              buildQotdReviewedEmbed(
                requestData.requesterId,
                requestData.question,
                requestData.date,
                `Approved by <@${interaction.user.id}>`
              ),
            ],
            components: [buildDisabledButtons(requestId)],
          });
        }

        if (requestData.type === 'event') {
          const approvedChannel = await client.channels
            .fetch(process.env.APPROVED_EVENT_CHANNEL_ID)
            .catch(() => null);

          if (approvedChannel) {
            const approvedEmbed = new EmbedBuilder()
              .setTitle('Approved Event')
              .addFields(
                { name: 'Event type', value: requestData.platform, inline: true },
                { name: 'Event name', value: requestData.name, inline: true },
                { name: 'Start', value: requestData.start, inline: true },
                { name: 'End', value: requestData.end, inline: true },
                { name: 'Prize', value: requestData.prize, inline: true },
                { name: 'Approved by', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Original requester', value: `<@${requestData.requesterId}>`, inline: true },
                { name: 'Description', value: requestData.description }
              )
              .setTimestamp();

            await approvedChannel.send({ embeds: [approvedEmbed] });
          }

          const requester = await client.users.fetch(requestData.requesterId).catch(() => null);
          if (requester) {
            const dmEmbed = buildDecisionDmEmbed(
              'Event Request Update',
              'Approved',
              interaction.user.id,
              [
                { name: 'Event type', value: requestData.platform, inline: true },
                { name: 'Event name', value: requestData.name, inline: true },
                { name: 'Start', value: requestData.start, inline: true },
                { name: 'End', value: requestData.end, inline: true },
                { name: 'Prize', value: requestData.prize, inline: true },
                { name: 'Description', value: requestData.description },
              ]
            );

            await requester.send({ embeds: [dmEmbed] }).catch(() => null);
          }

          return interaction.update({
            embeds: [
              buildEventReviewedEmbed(
                requestData.requesterId,
                requestData.platform,
                requestData.name,
                requestData.start,
                requestData.end,
                requestData.prize,
                requestData.description,
                `Approved by <@${interaction.user.id}>`
              ),
            ],
            components: [buildDisabledButtons(requestId)],
          });
        }
      }

      if (action === 'deny') {
        const modal = new ModalBuilder()
          .setCustomId(`denyModal_${requestId}`)
          .setTitle('Deny Request');

        const reasonInput = new TextInputBuilder()
          .setCustomId('denyReason')
          .setLabel('Reason for denial')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder('Explain why this request is being denied');

        modal.addComponents(
          new ActionRowBuilder().addComponents(reasonInput)
        );

        return interaction.showModal(modal);
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('eventModal_')) {
        const platformKey = interaction.customId.replace('eventModal_', '');
        const platform = platformKey === 'roblox' ? 'Roblox Event' : 'Discord Event';

        const name = interaction.fields.getTextInputValue('eventName');
        const start = interaction.fields.getTextInputValue('eventStart');
        const end = interaction.fields.getTextInputValue('eventEnd');
        const prize = interaction.fields.getTextInputValue('eventPrize');
        const description = interaction.fields.getTextInputValue('eventDescription');

        const reviewChannel = await client.channels.fetch(process.env.EVENT_REVIEW_CHANNEL_ID).catch(() => null);

        if (!reviewChannel) {
          return interaction.reply({
            content: 'Event review channel not found.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const requestId = interaction.id;

        const reviewMessage = await reviewChannel.send({
          embeds: [buildEventPendingEmbed(interaction.user.id, platform, name, start, end, prize, description)],
          components: [buildActiveButtons(requestId)],
        });

        requests.set(requestId, {
          id: requestId,
          type: 'event',
          requesterId: interaction.user.id,
          platform,
          name,
          start,
          end,
          prize,
          description,
          reviewChannelId: process.env.EVENT_REVIEW_CHANNEL_ID,
          reviewMessageId: reviewMessage.id,
          status: 'pending',
        });

        return interaction.reply({
          content: 'Your event request was submitted for review.',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (interaction.customId.startsWith('denyModal_')) {
        const requestId = interaction.customId.split('_')[1];
        const requestData = requests.get(requestId);

        if (!requestData) {
          return interaction.reply({
            content: 'That request could not be found.',
            flags: MessageFlags.Ephemeral,
          });
        }

        if (requestData.status !== 'pending') {
          return interaction.reply({
            content: 'This request has already been reviewed.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const member = interaction.member;
        const requiredRole = process.env.PR_LEADERSHIP_ROLE_ID;

        if (!member.roles.cache.has(requiredRole)) {
          return interaction.reply({
            content: 'You are not allowed to review requests.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const denyReason = interaction.fields.getTextInputValue('denyReason');

        requestData.status = 'denied';
        requestData.reviewerId = interaction.user.id;
        requestData.denyReason = denyReason;
        requests.set(requestId, requestData);

        if (requestData.type === 'qotd') {
          const requester = await client.users.fetch(requestData.requesterId).catch(() => null);
          if (requester) {
            const dmEmbed = buildDecisionDmEmbed(
              'QOTD Request Update',
              'Denied',
              interaction.user.id,
              [
                { name: 'Question', value: requestData.question },
                { name: 'Date', value: requestData.date, inline: true },
              ],
              denyReason
            );

            await requester.send({ embeds: [dmEmbed] }).catch(() => null);
          }

          const embed = buildQotdReviewedEmbed(
            requestData.requesterId,
            requestData.question,
            requestData.date,
            `Denied by <@${interaction.user.id}>`,
            denyReason
          );

          await editReviewMessage(requestData, embed);
        }

        if (requestData.type === 'event') {
          const requester = await client.users.fetch(requestData.requesterId).catch(() => null);
          if (requester) {
            const dmEmbed = buildDecisionDmEmbed(
              'Event Request Update',
              'Denied',
              interaction.user.id,
              [
                { name: 'Event type', value: requestData.platform, inline: true },
                { name: 'Event name', value: requestData.name, inline: true },
                { name: 'Start', value: requestData.start, inline: true },
                { name: 'End', value: requestData.end, inline: true },
                { name: 'Prize', value: requestData.prize, inline: true },
                { name: 'Description', value: requestData.description },
              ],
              denyReason
            );

            await requester.send({ embeds: [dmEmbed] }).catch(() => null);
          }

          const embed = buildEventReviewedEmbed(
            requestData.requesterId,
            requestData.platform,
            requestData.name,
            requestData.start,
            requestData.end,
            requestData.prize,
            requestData.description,
            `Denied by <@${interaction.user.id}>`,
            denyReason
          );

          await editReviewMessage(requestData, embed);
        }

        return interaction.reply({
          content: 'Request denied.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  } catch (error) {
    console.error(error);

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: 'Something went wrong.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
    } else {
      await interaction.reply({
        content: 'Something went wrong.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
    }
  }
});

(async () => {
  await registerCommands();
  await client.login(process.env.TOKEN);
})();