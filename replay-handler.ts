import cron from 'node-cron';
import { WebClient } from "@slack/web-api";
import { io } from "socket.io-client";
import { Client } from "ordr.js";
import type { CardBlock } from "@slack/types";

export type QueueItem = {
    md5: string,
    playerName: string,
    ts: string,
    channel?: string,
    userId: string,
    fileName: string,
    fromLastPlayed?: boolean
};

export const queue: QueueItem[] = [];
const rendering = new Map<number, QueueItem>();

const client = new WebClient(process.env.BOT_TOKEN);
const ordr = new Client(process.env.ORDR_TOKEN!);

export const replayRenderTask = cron.createTask('*/5 * * * * *', async (ctx) => {
    if (queue.length === 0) {
        replayRenderTask.stop();
        return;
    }

    const item = queue.shift();

    // This should really never happen, but typescript-language-server is screaming at me because of it.
    if (!item) {
        replayRenderTask.stop();
        return;
    }

    const render = await ordr.sendRender({
        replay: `.replay/${item.md5}.osr`,
        skin: 'default',
        username: item.playerName,
        showDanserLogo: false,
        resolution: '1280x720',
        introBGDim: 100,
        inGameBGDim: 100,
        breakBGDim: 100
    });

    // @ts-expect-error 0 is the code for "no error"
    if (render.errorCode !== 0) {
        client.reactions.add({
            channel: item.channel || 'C165V7XT9',
            name: 'x',
            timestamp: item.ts
        });

        client.chat.postMessage({
            channel: item.channel || 'C165V7XT9',
            thread_ts: item.ts,
            text: `:warning: *Hey <@${item.userId}>!* o!rdr refused your replay: \`${render.message}\``
        });

        return;
    }

    client.reactions.add({
        channel: item.channel || 'C165V7XT9',
        name: "thinkspin",
        timestamp: item.ts
    });

    rendering.set(render.renderID!, item)
});

const socket = io('https://apis.issou.best', {
    path: '/ordr/ws',
    autoConnect: true
});

socket.on('connect', () => {
    console.log('[ORDR] Connected to issou.best');
});

socket.on('disconnect', (reason) => {
    if (reason === "io server disconnect") {
        console.log('[ORDR] issou.best disconnected client, attempting to reconnect');
        setTimeout(() => socket.connect(), 5_000);
    }

    console.log('[ORDR] Disconnected from issou.best:', reason);
});

socket.on('render_done_json', async (render) => {
    const item = rendering.get(render.renderID!);

    if (!item) return;

    client.reactions.remove({
        channel: item.channel || 'C165V7XT9',
        name: 'thinkspin',
        timestamp: item.ts
    });

    client.chat.postMessage({
        channel: item.channel || 'C165V7XT9',
        thread_ts: item.ts,
        reply_broadcast: true,
        text: `<${render.videoUrl}|${item.fileName}>`,
        unfurl_media: true
    })

    rendering.delete(render.renderID!)

    if (item.fromLastPlayed) {
        const msgHist = await client.conversations.history({
            channel: item.channel || 'C165V7XT9',
            latest: item.ts,
            limit: 1,
            inclusive: true
        });

        if (!msgHist.messages || msgHist.messages.length === 0) return;

        const originalBlock = msgHist.messages?.[0]?.blocks?.[0] as unknown as CardBlock | undefined;
        if (!originalBlock) return;

        const oldActions = originalBlock.actions ?? [];
        const newActions = oldActions.map(action => {
            if (action.type === "button" && action.action_id === "generate_replay") {
                return {
                    ...action,
                    text: {
                        type: "plain_text",
                        text: "View Rendered Video",
                        emoji: false
                    },
                    action_id: "noop",
                    url: render.videoUrl
                } as any;
            }
            return action;
        });

        await client.chat.update({
            channel: item.channel || 'C165V7XT9',
            ts: item.ts,
            blocks: [
                {
                    ...originalBlock,
                    actions: newActions
                }
            ]
        })
    }
});

socket.on('render_failed_json', async (render) => {
    const item = rendering.get(render.renderID!);

    if (!item) return;

    client.reactions.remove({
        channel: item.channel || 'C165V7XT9',
        name: 'thinkspin',
        timestamp: item.ts
    });

    client.reactions.add({
        channel: item.channel || 'C165V7XT9',
        name: 'x',
        timestamp: item.ts
    });

    client.chat.postMessage({
        channel: item.channel || 'C165V7XT9',
        thread_ts: item.ts,
        text: `:warning: *Hey <@${item.userId}>!* o!rdr couldn't render your replay for some reason: \`${render.errorMessage}\``
    });

    rendering.delete(render.renderID!)
})