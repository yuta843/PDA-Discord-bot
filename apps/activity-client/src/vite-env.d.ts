/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DISCORD_CLIENT_ID?: string;
  readonly VITE_DEV_MODE?: string;
  readonly VITE_ACTIVITY_INSTANCE_ID?: string;
  readonly VITE_DEV_GUILD_ID?: string;
  readonly VITE_SOCKET_URL?: string;
  readonly VITE_STANDEE_IMAGE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
