function countryCodeToUrlFriendly(code: string) {
    // Uppercase & validate
    code = code.toUpperCase();

    if (!/^[A-Z]{2}$/.test(code)) {
        throw new Error(`Invalid country code: "${code}"`);
    }

    // Convert A-Z letters (regional indicators)
    const codePoints = [...code].map(c => 0x1F1E6 + (c.charCodeAt(0) - 65));

    // Convert to lowercase hex + join
    return codePoints.map(cp => cp.toString(16)).join('-');
}

import createExpressServer, { type Application, type IRouter, static as staticServe } from "express";
import { sendGET } from "./utils";
import { WebClient } from "@slack/web-api";
import { createHash } from "crypto";
import sql from "./postgres";

const md5 = (str: string) => createHash('md5').update(str).digest('hex')

const states = new Map();

const client = new WebClient(process.env.BOT_TOKEN);

const userCache: {
    osuId: string,
    slackId: string,
    slackDisplayName: string,
    slackAvatar: string,
    scores: Record<'osu' | 'taiko' | 'fruits' | 'mania', number>,
    flag: string
}[] = [];
const shouldRecache = { current: true }

function splitArray<T>(arr: T[], maxElements: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += maxElements) {
        result.push(arr.slice(i, i + maxElements));
    }
    return result;
}

export async function cacheLeaderboard(): Promise<typeof userCache> {
    if (!shouldRecache.current) return userCache

    const users = await sql<{ osu_id: string, slack_id: string }[]>`SELECT * FROM users`;

    userCache.length = 0

    for (const batch of splitArray(users, 50)) {
        const data = await sendGET<{
            users: {
                id: number,
                username: string,
                country_code: string,
                statistics_rulesets: Record<'osu' | 'taiko' | 'fruits' | 'mania', {
                    pp: number
                }>
            }[]
        }>(`/users?${batch.map(x => `ids[]=${x.osu_id}`).join('&')}`);

        userCache.push(
            ...(
                await Promise.all(
                    data.users.map(async osuData => {
                        const slackData = await client.users.info({ user: batch.find(u => u.osu_id == osuData.id.toString())!.slack_id });

                        return {
                            osuId: osuData.id.toString(),
                            slackId: batch.find(u => u.osu_id == osuData.id.toString())!.slack_id,
                            slackDisplayName: slackData.user!.profile!.display_name! || slackData.user!.profile!.first_name!,
                            slackAvatar: `https://ca.slack-edge.com/${slackData.user!.team_id!}-${slackData.user!.id!}-${slackData.user!.profile!.avatar_hash!}-1024`,
                            scores: {
                                osu: Math.floor(osuData.statistics_rulesets.osu?.pp) || 0,
                                taiko: Math.floor(osuData.statistics_rulesets.taiko?.pp) || 0,
                                fruits: Math.floor(osuData.statistics_rulesets.fruits?.pp) || 0,
                                mania: Math.floor(osuData.statistics_rulesets.mania?.pp) || 0,
                            },
                            flag: countryCodeToUrlFriendly(osuData.country_code)
                        }
                    })
                )
            )
        )
    }

    shouldRecache.current = false

    setTimeout(() => {
        shouldRecache.current = true
    }, 60 * 1_000)

    return userCache
}

const HCA_URL = "auth.hackclub.com";

export default function Setup(express: Application, app: IRouter) {
    express.set('view engine', 'ejs')

    app.get('/', (req, res) => {
        res.render('index')
    })

    app.use('/static', staticServe('static'))

    app.get('/leaderboard', async (req, res) => {
        const lb = await cacheLeaderboard();

        if (req.query.mode && ['osu', 'taiko', 'fruits', 'mania'].includes(req.query.mode as 'osu' | 'taiko' | 'fruits' | 'mania')) {
            return res.render('leaderboard', { lb, default_mode: req.query.mode });
        }

        res.render('leaderboard', { lb, default_mode: "osu" })
    })

    app.get('/link', async (req, res) => {
        // redirect to hca
        res.redirect(`https://${HCA_URL}/oauth/authorize?client_id=${process.env.IDV_CLIENT_ID}&redirect_uri=${encodeURIComponent(`${req.protocol}://${req.hostname}/hca/oauth_callback`)}&response_type=code&scope=slack_id`)
    })

    app.get('/hca/oauth_callback', async (req, res) => {
        const code = req.query.code;

        if (!code) return res.json({ ok: false }) && undefined;

        const idvRes = await fetch(`https://${HCA_URL}/oauth/token`, {
            method: 'POST',
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: `client_id=${process.env.IDV_CLIENT_ID}&client_secret=${encodeURIComponent(process.env.IDV_CLIENT_SECRET)}&redirect_uri=${encodeURIComponent(`${req.protocol}://${req.hostname}/hca/oauth_callback`)}&code=${code}&grant_type=authorization_code`
        }).then(res => res.json()) as { access_token?: string };

        if (idvRes.access_token) {
            const idvUser = await fetch(`https://${HCA_URL}/api/v1/me`, {
                headers: {
                    'Authorization': `Bearer ${idvRes.access_token}`
                }
            }).then(res => res.json()) as { identity: { id: string, slack_id: string } };

            const state = `OSUBOT-${idvUser.identity.slack_id}-${Date.now()}`

            states.set(idvUser.identity.slack_id, state)

            return res.redirect(`https://osu.ppy.sh/oauth/authorize?client_id=${process.env.OSU_CLIENT_ID}&redirect_uri=${encodeURIComponent(`${req.protocol}://${req.hostname}/osu/oauth_callback`)}&response_type=code&state=${encodeURIComponent(idvUser.identity.slack_id + ":" + md5(state))}&scope=public`)
        } else {
            console.log(idvRes)
            return res.json({ ok: false }) && undefined;
        }
    })

    app.get('/osu/oauth_callback', async (req, res) => {
        if (req.query.error) return res.json({ ok: false }) && undefined;

        const code = req.query.code as string;
        const state = req.query.state as string;

        let _userId

        try {
            const [userId, hash] = state.split(':');

            const isValid = md5(states.get(userId)) == hash;

            if (!isValid) {
                throw new Error();
            }

            _userId = userId

            states.delete(userId);
        } catch (err) {
            return res.json({ ok: false }) && undefined;
        }


        const data = await fetch("https://osu.ppy.sh/oauth/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: `client_id=${process.env.OSU_CLIENT_ID}&client_secret=${encodeURIComponent(process.env.OSU_CLIENT_SECRET!)}&code=${code}&grant_type=authorization_code&scope=public&redirect_uri=${encodeURIComponent(`${req.protocol}://${req.hostname}/osu/oauth_callback`)}`
        }).then(res => res.json()) as { access_token: undefined, message: string, error: string } | { access_token: string, message: undefined, error: undefined };

        if (data.error) {
            console.log(data)
            return res.json({ ok: false }) && undefined;
        } else {
            const user = await sendGET<{ id: number }>('/me', data.access_token);

            await sql`INSERT INTO users VALUES (${_userId!}, ${user.id.toString()})`

            return res.render('oauth_callback', { osuId: user.id, slackId: _userId });
        }
    })

    app.get('/multi-lobby-join', async (req, res) => {
        if (!req.query.id) return res.json({ ok: false }) && undefined;

        res.render('multi_lobby_join', { code: req.query.id })
    })

    app.get('/api', (req, res) => {
        res.status(204).end();
    })

    app.get('/api/leaderboard', async (req, res) => {
        const lb = await cacheLeaderboard();

        res.json(lb)
    })
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const app = createExpressServer();

    app.use((req, res, next) => {
        console.log(req.method, req.url)
        next();
    })

    Setup(app, app.router);

    app.listen(3000, () => {
        console.log('HTTP server is running standalone.')
    })
}