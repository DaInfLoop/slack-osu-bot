import type { AllMiddlewareArgs, BlockButtonAction, SlackActionMiddlewareArgs, StringIndexed } from "@slack/bolt";
import { sendGET } from "../../utils";
import fs from "node:fs";
// @ts-expect-error No typings!
import osr from "node-osr";
import { queue, replayRenderTask } from "../../replay-handler";
import type { OsuScore } from "../commands/osu-lastplayed";

export default async function GenerateReplay(ctx: SlackActionMiddlewareArgs<BlockButtonAction> & AllMiddlewareArgs<StringIndexed>) {
    await ctx.ack();
    try {
        const channelInfo = await ctx.client.conversations.info({
            channel: ctx.body.channel?.id!
        });
        
        if (!channelInfo.ok) {
            return ctx.client.chat.postMessage({
                channel: ctx.body.user.id,
                text: `:warning: You tried to generate <https://${ctx.body.team?.domain}.slack.com/archives/${ctx.body.channel?.id}/p${ctx.body.message?.ts.replace('.', '')}|a replay>, but I can't send messages in <#${ctx.body.channel?.id}>. Please invite me to the channel and try again.`
            });
        }
    } catch (e) {
        const err = e as NodeJS.ErrnoException & { data?: {
            ok: false,
            error: string
        } };

        if (err.code === 'slack_webapi_platform_error' && err.data?.error === 'channel_not_found')
            return ctx.client.chat.postMessage({
                channel: ctx.body.user.id,
                unfurl_links: true,
                text: `:warning: You tried to generate <https://${ctx.body.team?.domain}.slack.com/archives/${ctx.body.channel?.id}/p${ctx.body.message?.ts.replace('.', '')}|a replay>, but I can't send messages in <#${ctx.body.channel?.id}>. Please invite me to the channel and try again.`
            });

        console.error(err);
        return ctx.client.chat.postMessage({
            channel: ctx.body.user.id,
            unfurl_links: true,
            text: `:warning: An unexpected error occurred while trying to generate <https://${ctx.body.team?.domain}.slack.com/archives/${ctx.body.channel?.id}/p${ctx.body.message?.ts.replace('.', '')}|a replay>. Contact the bot maintainer.`
        });
    }

    const replayId = ctx.action.value;

    const replayInfo = await sendGET<OsuScore>(`/scores/${replayId}`, { json: true });
    const replayData = await sendGET(`/scores/${replayId}/download`, { json: false });

    const replayBuffer = Buffer.from(replayData);

    const _replay = await osr.read(replayBuffer);

    if (queue.some(item => item.md5 === _replay.replayMD5)) {
        return ctx.respond({
            response_type: 'ephemeral',
            text: `:warning: This replay has already been queued for rendering.`
        });
    }

    if (_replay.gameMode !== 0) {
        return ctx.respond({
            response_type: 'ephemeral',
            text: `:warning: *Hey <@${ctx.body.user.id}>!* Unfortunately, o!rdr doesn't support replays other than :osu-standard: osu!standard replays, so I can't render this replay. Sorry!`
        });
    }

    // ensure .replays folder exists
    try {
        const statRes = await fs.promises.stat('.replay');
        if (!statRes.isDirectory()) throw { code: 'IS_A_FILE' }
    } catch (e) {
        const err = e as NodeJS.ErrnoException;

        if (err.code == 'ENOENT') {
            await fs.promises.mkdir('.replay')
        } else {
            return ctx.respond({
                response_type: 'ephemeral',
                text: `:warning: *Hey <@${ctx.body.user.id}>!* An unexpected error occurred while trying to handle your replay. Contact the bot maintainer. (${err.code})`
            });
        }
    }

    const replayFile = fs.createWriteStream(`.replay/${_replay.replayMD5}.osr`);

    replayFile.write(replayBuffer);
    replayFile.end();

    replayFile.on('finish', async () => {
        queue.push({
            md5: _replay.replayMD5,
            playerName: _replay.playerName,
            ts: ctx.body.message?.ts!,
            channel: ctx.body.channel?.id!,
            userId: ctx.body.user.id,
            fileName: `${_replay.playerName} playing ${replayInfo.beatmapset.artist} - ${replayInfo.beatmapset.title} [${replayInfo.beatmap.version}]`,
            fromLastPlayed: true
        })

        await ctx.respond({
            response_type: 'ephemeral',
            text: `:white_check_mark: This replay is now queued for rendering.`
        });

        replayRenderTask.start();
    })
}