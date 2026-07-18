import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { CharacterState, ServerToClientEvents } from '@miq/pachinko-shared';

const INITIAL_STATE: CharacterState = {
  phase: 'idle',
  emotion: 'neutral',
  text: '',
  turnId: null,
  updatedAt: new Date(0).toISOString(),
};

type ActivityConfig = { clientId: string; devAuthEnabled: boolean };

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Activity authentication failed (${response.status}).`);
}

async function authenticateActivity(config: ActivityConfig) {
  const params = new URLSearchParams(window.location.search);
  if (config.devAuthEnabled && import.meta.env.VITE_DEV_MODE === 'true') {
    const instanceId = params.get('instance_id') ?? import.meta.env.VITE_ACTIVITY_INSTANCE_ID ?? '';
    const guildId = params.get('guild_id') ?? import.meta.env.VITE_DEV_GUILD_ID ?? '';
    if (!instanceId || !guildId) throw new Error('Local Activity instance and guild IDs are required.');
    await postJson('/api/auth/dev', { instanceId, guildId });
    return { instanceId };
  }

  const { DiscordSDK } = await import('@discord/embedded-app-sdk');
  const sdk = new DiscordSDK(config.clientId);
  await sdk.ready();
  if (!sdk.instanceId || !sdk.guildId) throw new Error('Launch this Activity inside a Discord server.');
  const stateResponse = await fetch('/api/auth/state', { credentials: 'include' });
  if (!stateResponse.ok) throw new Error('Could not initialize Discord authentication.');
  const { state } = await stateResponse.json() as { state?: string };
  if (!state) throw new Error('Discord authentication state was missing.');
  const { code } = await sdk.commands.authorize({
    client_id: config.clientId,
    response_type: 'code',
    scope: ['identify'],
    state,
  });
  await postJson('/api/auth/discord', { code, state, instanceId: sdk.instanceId, guildId: sdk.guildId });
  return { instanceId: sdk.instanceId };
}

export function useCharacterState() {
  const [state, setState] = useState<CharacterState>(INITIAL_STATE);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let socket: Socket<ServerToClientEvents> | null = null;
    void (async () => {
      try {
        const response = await fetch('/api/activity-config');
        if (!response.ok) throw new Error('Activity configuration is unavailable.');
        const config = await response.json() as ActivityConfig;
        const { instanceId } = await authenticateActivity(config);
        if (disposed) return;
        socket = io({ auth: { roomId: instanceId }, withCredentials: true, transports: ['websocket', 'polling'] });
        socket.on('connect', () => { setConnected(true); setError(null); });
        socket.on('disconnect', () => {
          setConnected(false);
          setState(INITIAL_STATE);
        });
        socket.on('connect_error', (socketError) => setError(socketError.message));
        socket.on('character:state', setState);
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : 'Activity startup failed.');
      }
    })();
    return () => {
      disposed = true;
      socket?.disconnect();
    };
  }, []);

  return { state, connected, error };
}
