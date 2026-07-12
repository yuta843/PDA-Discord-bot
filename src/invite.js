import { PermissionFlagsBits, PermissionsBitField } from "discord.js";

const invitePermissions = new PermissionsBitField([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.UseApplicationCommands,
]);

function buildServerInviteUrl(clientId) {
  if (!/^\d+$/.test(clientId)) {
    throw new Error("A valid Discord application ID is required.");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    integration_type: "0",
    permissions: invitePermissions.bitfield.toString(),
    scope: "bot applications.commands",
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

export { buildServerInviteUrl, invitePermissions };
