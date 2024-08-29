import Data from './data/sources';
import * as Diff from 'diff';

/**
 * Welcome to Cloudflare Workers!
 *
 * This is a template for a Scheduled Worker: a Worker that can run on a
 * configurable interval:
 * https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Run `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"` to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

interface Env {
	CAREER_KV: KVNamespace;
	DISCORD_WEBHOOK: string;
	// ... other binding types
}

// a function that takes in markup as string, and strips away all content between <script> tags and <style> tags
function stripScriptAndStyle(markup: string): string {
	return (
		markup
			.replace(/<script.*?<\/script>/gs, '')
			.replace(/<style.*?<\/style>/gs, '')
			.replace(/<footer.*?<\/footer>/gs, '')
			.replace(/<nav.*?<\/nav>/gs, '')
			// comments
			.replace(/<!--.*?-->/gs, '')
			// symbols
			.replace(/<symbol.*?<\/symbol>/gs, '')
			// fill
			.replace(/<fill.*?<\/fill>/gs, '')
			// noscript
			.replace(/<noscript.*?<\/noscript>/gs, '')
			// svg
			.replace(/<svg.*?<\/svg>/gs, '')
			// \t and \n
			.replace(/\t/g, '')
			.replace(/\n/g, '')
	);
}

async function main(env: Env) {
	// We'll loop through our data sources and create promises
	const promises = Data.map(async (source) => {
		const response = await fetch(source.url);
		// We'll use the NodeHtmlMarkdown library to convert the HTML to Markdown
		const markdown = stripScriptAndStyle(await response.text());
		// check if the source.name exists in KV
		const KVval = await env.CAREER_KV.get(source.name);
		if (KVval === null) {
			console.log('KVval is null for ', source.name, ' putting in KV');
			// If it doesn't exist, we'll store the response in KV
			await env.CAREER_KV.put(source.name, markdown);
			// return diff, which is empty here
			return null;
		}
		// If it does exist, we'll compare the new response to the old response
		// calculate the diff
		const diff = Diff.diffChars(KVval, markdown);
		console.log('Diff: ', diff);
		// If the diff is empty, we'll return null
		if (diff.length === 1) {
			return null;
		}
		// If the diff isn't empty, we'll store the new response in KV
		await env.CAREER_KV.put(source.name, markdown);
		// return the diff as an array of strings
		return diff
			.map((part) => {
				// return only parts added
				if (part.added) {
					return part.value;
				}
			})
			.filter((part) => part !== undefined);
	});

	const results = await Promise.all(promises);
	const processed = results
		.map((result, index) => {
			if (result === null) {
				return null;
			}
			// if a result is a string with just numbers, we'll return null
			if (result.join('').replace(/[^0-9]/g, '') === result.join('')) {
				return null;
			}
			// if a results has more numbers than letters, we'll return null
			if (result.join('').replace(/[^0-9]/g, '').length > result.join('').replace(/[^a-zA-Z]/g, '').length) {
				return null;
			}
			// if the string doesn't have html tags, we'll return null
			if (!result.join('').includes('<')) {
				return null;
			}
			return `<h2>${Data[index].name}</h2><pre>${result.join(' ')}</pre>`;
		})
		.filter((result) => result !== null);

	console.log('Processed: ', processed);

	// If there are no results, we'll return early
	// if (processed.length === 0) {
	// 	return;
	// }

	// If there are results, we'll trigger a discord webhook
	const discordWebhook = env.DISCORD_WEBHOOK;
	// console.log('Discord Webhook: ', discordWebhook);
	const discordBody = {
		content: processed && processed.length > 0 ? 'New job postings detected!' : 'No new job postings detected!',
		embeds:
			processed && processed.length > 0
				? processed.map((result) => ({
						description: result,
				  }))
				: [
						{
							description: 'No new job postings detected!',
						},
				  ],
	};

	const finalresp = await fetch(discordWebhook, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(discordBody),
	});

	// check if the response was successful
	const wasSuccessful = finalresp.ok;
	if (!wasSuccessful) {
		try {
			const err = await finalresp.json();
			console.log('Error: ', err);
		} catch (e) {
			console.log('Error: ', e);
			const err = await finalresp.text();
			console.log('Error: ', err);
		}
	}
	return wasSuccessful;
}

export default {
	// The scheduled handler is invoked at the interval set in our wrangler.toml's
	// [[triggers]] configuration.
	async scheduled(event, env, ctx): Promise<void> {
		// A Cron Trigger can make requests to other endpoints on the Internet,
		// publish to a Queue, query a D1 Database, and much more.
		console.log(`trigger fired at ${event.cron}`);
		const resp = await main(env);
		console.log('Response: ', resp);
		// You could store this result in KV, write to a D1 Database, or publish to a Queue.
		// In this template, we'll just log the result:
		// console.log(`trigger fired at ${event.cron}: ${wasSuccessful}`);
	},
	async fetch(event, env, ctx): Promise<Response> {
		console.log('fetch event');
		const resp = await main(env);
		return new Response(
			JSON.stringify({
				success: resp,
			})
		);
	},
} satisfies ExportedHandler<Env>;
