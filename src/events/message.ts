import type { AllMiddlewareArgs, SlackEventMiddlewareArgs, StringIndexed } from "@slack/bolt";
import osr from "node-osr";
import fs from "node:fs/promises";

// For proper type-checking + intellisense, replace "event_template" with the raw event name
export default async function Message(ctx: SlackEventMiddlewareArgs<"message"> & AllMiddlewareArgs<StringIndexed>) {
    if (ctx.event.channel !== "C165V7XT9") return;
    if (ctx.event.subtype !== "file_share") return;

    const msg = ctx.body.message!;

    if (!msg.files) return;
    if (msg.files.length === 0) return;

    const replay = msg.files.find(file => file.name?.endsWith('.osr'));

    if (!replay) return;

    const replayData = await fetch(replay.url_private_download!, {
        headers: {
            'Authorization': `Bearer ${process.env.BOT_TOKEN}`
        }
    }).then(res => res.arrayBuffer());

    const replayBuffer = Buffer.from(replayData);

    const _replay = await osr.read(replayBuffer);

    if (_replay.gameMode !== 0) {
        return ctx.client.chat.postEphemeral({
            channel: "C165V7XT9",
            user: ctx.body.user_id!,
            text: `:warning: *Hey <${ctx.body.user_id}>!* You uploaded a replay file. Unfortunately, o!rdr doesn't support replays other than :osu-standard: osu!standard replays, so I can't render your replay. Sorry!`
        });     
    }

    // ensure .replays fodler exists
    try {
        const statRes = await fs.stat('.replay');
        if (!statRes.isDirectory()) throw { code: 'IS_A_FILE' }
    } catch (err) {
        if (err.code == 'ENOENT') {
            await fs.mkdir('.replay')
        } else {
            return ctx.client.chat.postEphemeral({
                channel: "C165V7XT9",
                user: ctx.body.user_id!,
                text: `:warning: *Hey <${ctx.body.user_id}>!* An unexpected error occured while trying to handle your replay. Contact the bot maintainer. (${err.code})`
            });
        }
    }

    const replayFile = fs.createWriteStream(`.replay/${_replay.replayMD5}.osr`);

    replayFile.write(replayBuffer);
    replayFile.end();

    replayFile.on('finish', () => {
        // TODO: implement queue system again
    })
}