declare global {
    namespace NodeJS {
        interface ProcessEnv {
            NODE_ENV: 'development' | 'production';
            PORT?: string;

            // Slack creds
            BOT_TOKEN: string;
            SIGNING_SECRET: string;

            // osu! creds
            OSU_CLIENT_ID: string;
            OSU_CLIENT_SECRET: string;

            // HCA Identity Vault creds
            IDV_CLIENT_ID: string;
            IDV_CLIENT_SECRET: string;

            // ngrok creds
            NGROK_TOKEN?: "NONE" | string;
            NGROK_DOMAIN?: string;

            // Postgres creds
            PG_HOST: string;
            PG_USER: string;
            PG_DATABASE: string;
            PG_PASSWORD: string;
        }
    }
}

export { }