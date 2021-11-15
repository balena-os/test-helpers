/**
 * # Utility helpers
 *
 * The module contains helpers to better write tests.
 *
 * @module Leviathan Utility helpers
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
import { NodeSSH } from 'node-ssh';
import Bluebird from 'bluebird';
import { fs } from 'mz';
import path from 'path';
import { promisify } from 'util';
import * as Child_Process from 'child_process';
const exec = promisify(Child_Process.exec);

const keygen = promisify(require('ssh-keygen'));

function getSSHClientDisposer(config: any) {
	const createSSHClient = (conf: any) => {
		return Bluebird.resolve(
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
	 * @param {*} config
	 *
	 * @category helper
	 */
	async executeCommandOverSSH(command: string, config: any): Promise<any> {
		return Bluebird.using(getSSHClientDisposer(config), (client: any) => {
			return new Promise(async (resolve, reject) => {
				client.connection.on('error', (err: any) => {
					reject(err);
				});
				resolve(
					await client.exec(command, [], {
						stream: 'both',
					}),
				);
			});
		});
	}
	async waitUntil(
		promise: () => Promise<boolean>,
		rejectionFail = false,
		_times = 7,
		_delay = 15000,
	) {
		const _waitUntil = async (timesR: number): Promise<any> => {
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
		};
		await _waitUntil(_times);
	}
	async createSSHKey(keyPath: string) {
		return (await fs
			.access(path.dirname(keyPath))
			.then(async () => {
				const keys = await keygen({
					location: keyPath,
				});
				await exec('ssh-add -D');
				await exec(`ssh-add ${keyPath}`);
				return keys
			})).pubKey.trim()
	}
}
