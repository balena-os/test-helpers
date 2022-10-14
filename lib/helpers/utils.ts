/**
 * # Levaithan Utilities
 *
 * The module contains helpers for helping with test execution or better write tests.
 *
 * @module Leviathan Utilities
 */

/*
 * Copyright 2021 balena
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


import { assignIn } from 'lodash';
import NodeSSH from 'node-ssh';
import Bluebird from 'bluebird';
import { access } from 'node:fs/promises';
import path from 'path';
import { promisify } from 'util';
import { exec as Exec } from 'child_process';
const exec = promisify(Exec);
const keygen = require('ssh-keygen-lite');


function getSSHClientDisposer(config: any) {
	const createSSHClient = (conf: any) => {
		return Bluebird.resolve(
			// @ts-ignore
			new NodeSSH().connect(
				assignIn(
					{
						agent: process.env.SSH_AUTH_SOCK,
						keepaliveInterval: 10000 * 60 * 5, // 5 minute interval
					},
					conf,
				),
			),
		);
	};

	return createSSHClient(config).disposer((client: any) => {
		client.dispose();
	});
}

export class Utils {
	/**
	 * This is the base hostOS execution command used by many other functions like `executeCommandIntoHostOs` to
	 * execute commands on the DUT being passed through SSH.
	 *
	 * @param {string} command The command to be executed over SSH
	 * @param {} config SSH config 
	 *
	 * @category helper
	 */
	async executeCommandOverSSH(command: string, config: {}): Promise<any> {
		return Bluebird.using(getSSHClientDisposer(config), (client) => {
			return new Bluebird(async (resolve, reject) => {
				try {
					client.connection.on('error', (err: any) => {
						console.log(`Connection err: ${err.message}`)
						reject(err);
					});

					resolve(
						await client.exec(command, [], {
							stream: 'both',
						}),
					);
				} catch (e) {
					reject(e)
				}
			})
		})
	}

	/**
	 * @param {string} promise The command you need to wait for
	 * @param {boolean} rejectionFail Whether the `waitUntil()` function error out, if a iteration fails once. Defaults to `false`, which results in `waitUntil()` not failing as it iterates and wait for the condition to satisfy.
	 * @param {number} _times Specify how many times should the command be executed
	 * @param {number} _delay Specify the delay between each iteration of the command execution
	 * @throws error on first iteration if`rejectionFail` is true. Otherwise throws error after iterating through the specified `_times` parameter
	 *
	 * @category helper
	 */
	async waitUntil(
		promise: () => Promise<boolean>,
		rejectionFail: boolean = false,
		_times: number = 20,
		_delay: number = 30000,
	): Promise<any> {
		async function _waitUntil(timesR: number): Promise<any> {
			if (timesR === 0) {
				throw new Error(`Condition ${promise} timed out`);
			}

			try {
				if (await promise()) {
					return;
				}
			} catch (error) {
				if (rejectionFail) {
					throw error;
				}
			}

			await Bluebird.delay(_delay);
			return _waitUntil(timesR - 1);
		}

		await _waitUntil(_times);
	}

	async createSSHKey(keyPath: string) {
		try {
			await access(path.dirname(keyPath)) 
			const keys = await keygen({
				location: keyPath,
				type: 'ed25519'
			});
			await exec('ssh-add -D');
			await exec(`ssh-add ${keyPath}`);
			return {
				pubKey: keys.pubKey.trim(),
				key: keys.key.trim(),
			};
		} catch (err) {
			throw new Error(`SSH keys can't be created due to: ${err}`)
		}
	}
}
