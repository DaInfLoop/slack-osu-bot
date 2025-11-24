import type { Application, IRouter } from "express";
import { createHash } from "crypto";
import sql from "./postgres";
import { sendGET } from "./utils";

const md5 = (str: string) => createHash('md5').update(str).digest('hex')

const states = new Map();

const HCA_URL = "identity.hackclub.com"

export default function (express: Application, app: IRouter) {
    express.set('view engine', 'ejs')

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
}