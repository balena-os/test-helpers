/**
 * # balenaSDK helpers
 *
 * The `BalenaSDK` class contains an instance of the balena sdk, as well as some helper methods to interact with a device via the cloud.
 * The `balena` attribute of the class contains the sdk,and can be used as follows in a test suite:
 *
 * @example
 * ```js
 * const Cloud = this.require("components/balena/sdk");
 *
 * this.suite.context.set({
 *	cloud: new Balena(`https://api.balena-cloud.com/`, this.getLogger())
 * });
 *
 * // login
 * await this.context
 *	.get()
 *	.cloud.balena.auth.loginWithToken(this.suite.options.balena.apiKey);
 *
 * // create a balena application
 * await this.context.get().cloud.balena.models.application.create({
 * 	name: `NAME`,
 * 	deviceType: `DEVICE_TYPE`,
 *  organization: `ORG`,
 * });
 * ```
 *
 * @module balenaSDK helpers
 */

/*
 * Copyright 2023 balena
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

'use strict';

import { find, toInteger } from 'lodash';
import fs from 'fs';
import { join } from 'path';
import retry from 'bluebird-retry';
import Bluebird from 'bluebird';
import { utils } from './utils';
const { spawn } = require('child_process')
import { BalenaSDK, getSdk } from 'balena-sdk';
import { config } from '../config';

export class Sdk {
	private balena: BalenaSDK;
	private logger: any;
	constructor(
		apiUrl: string,
		logger = { log: console.log, status: console.log, info: console.log },
	) {
		this.balena = getSdk({
			apiUrl: `https://api.${apiUrl}`,
		});
		this.logger = logger;
	}

	/**
	 * Executes command-line operations in the host OS of the DUT. Assuming the DUT is a managed device.
	 *
	 * @param {string} command command to be executed on the DUT
	 * @param {string} device local UUID of the DUT, example:`${UUID}.local`
	 * @param {{"interval": number, "tries": number}} timeout object containing details of how many times the command needs to be retried and the intervals between each command execution
	 * @returns {string} Output of the command that was exected on hostOS of the DUT
	 *
	 * @category helper
	 */
	async executeCommandInHostOS(
		command: string,
		device: string,
		timeout: { "interval": number; "tries": number; } = {
			interval: 1000,
			tries: 600,
		},
	): Promise<string> {
		const sshPort = 22;

		return retry(
			async () => {
				if (!(await this.balena.models.device.isOnline(device))) {
					throw new Error(`${device}: is not marked as connected to our VPN.`);
				}

				const result: any = await utils.executeCommandOverSSH(
					`host -s ${device} source /etc/profile ; ${command}`,
					{
						host: `ssh.${await this.balena.settings.get('proxyUrl')}`,
						username: await this.balena.auth.whoami(),
						port: sshPort,
					},
				);

				if (result.code !== 0) {
					throw new Error(
						`"${command}" failed. stderr: ${result.stderr}, stdout: ${result.stdout}, code: ${result.code}`,
					);
				}

				return result.stdout;
			},
			{
				max_tries: timeout.tries,
				interval: timeout.interval,
				throw_original: true,
			},
		);
	}

	/**
	* Removes SSH key from balenaCloud account
	* 
	* @param {string} label SSH key label 
	* 
	* @category helper
	*/
	async removeSSHKey(label: string) {
		this.logger.log(`Delete SSH key with label: ${label}`);

		const keys = await this.balena.models.key.getAll();
		const key = find(keys, {
			title: label,
		});

		if (key) {
			return this.balena.models.key.remove(key.id);
		}

		return Bluebird.resolve();
	}

	/**
	 * Pushes a release to an application from a given directory for managed devices
	 * @param {string} application The balena application name to push the release to
	 * @param {string} directory The path to the directory containing the docker-compose/Dockerfile for the application and the source files
	 * @returns {string} returns release commit after `balena push` is complete
	 *
	 * @category helper
	 */
	async pushReleaseToApp(application: string, directory: string) {
		//await exec(`balena push ${application} --source ${directory}`);
		await new Promise<void>(async (resolve, reject) => {
			let balenaPush = spawn('balena', [
				'push',
				application,
				'--source',
				directory,
				'--debug',
			], { stdio: 'inherit', timeout: 1000 * 60 * 10 }); // 10 minutes


			balenaPush.on('close', (code: number) => {
				if (code != 0) {
					console.log(`balena Push exited with code ${code}`);
					reject()
				}
				resolve()
			});

			// For debugging: Push logs to the console or use the archiver to output logs 
			// balenaPush.stdout.on('data', (data) => {
			// this.logger.log(data.toString())
			// })

			balenaPush.on('error', (err: any) => {
				balenaPush.kill()
				reject(err);
			});
		});

		// check new commit of app
		let commit = await this.balena.models.application.getTargetReleaseHash(
			application,
		);
		return commit;
	}

	/**
	 * Waits until all given services are running on the device on the provided commit
	 * @param {string} uuid The UUID of the device
	 * @param {Array[string]} services An array of the service names
	 * @param {string} commit The release commit hash that services should be on
	 * @param {number} retries (optional) The number of attemps to retry. Retries are spaced 30s apart
	 * @returns {boolean} returns true if all services in the release commit are running on the device
	 *
	 * @category helper
	 */
	async waitUntilServicesRunning(uuid: string, services: Array<string>, commit: string, retries = 50) {
		await utils.waitUntil(
			async () => {
				let deviceServices = await this.balena.models.device.getWithServiceDetails(
					uuid,
				);
				let running = false;
				running = services.every((service: string) => {
					return (
						deviceServices.current_services[service][0].status === 'Running' &&
						deviceServices.current_services[service][0].commit === commit
					);
				});
				return running;
			},
			false,
			retries,
		);
	}

	/**
	 * Executes the command in the targetted container of a device
	 * @param {string} command The command to be executed
	 * @param {string} containerName The name of the service/container to run the command in
	 * @param {string} uuid The UUID of the target device
	 * @returns {string} output of the command that is executed on the targetted container of the device
	 *
	 * @category helper
	 */
	async executeCommandInContainer(command: string, containerName: string, uuid: string): Promise<string> {
		// get the container ID of container through balena engine
		const containerId = await this.executeCommandInHostOS(
			`balena ps --format "{{.Names}}" | grep ${containerName}`,
			uuid,
		);

		const stdout = await this.executeCommandInHostOS(
			`balena exec ${containerId} ${command}`,
			uuid,
		);

		return stdout;
	}

	/**
	 * @param {string} uuid The UUID of the target device
	 * @param {string} contains The string to look for in the logs
	 * @param {number} _start (optional) start the search from this log
	 * @param {number} _end (optional) end the search at this log
	 * @returns {boolean} If device logs contain the string
	 *
	 * @category helper
	 */
	async checkLogsContain(uuid: string, contains: string, _start = '', _end = '') {
		let logs = await this.balena.logs.history(uuid);
		let logsMessages = logs.map((log) => {
			return log.message;
		});

		let startIndex = _start != null ? logsMessages.indexOf(_start) : 0;
		let endIndex = _end != null ? logsMessages.indexOf(_end) : logsMessages.length;
		let slicedLogs = logsMessages.slice(startIndex, endIndex);

		let pass = false;
		slicedLogs.forEach((element) => {
			if (element.includes(contains)) {
				pass = true;
			}
		});

		return pass;
	}

	/**
	 * @param {string} uuid UUID of the device
	 * @returns {Promise<string>} Returns the supervisor version on a device
	 *
	 * @category helper
	 */
	async getSupervisorVersion(uuid: string): Promise<string> {
		let checkName = await this.executeCommandInHostOS(
			`balena ps | grep balena_supervisor`,
			uuid
		);
		let supervisorName = (checkName !== "") ? `balena_supervisor` : `resin_supervisor`
		let supervisor: any = await this.executeCommandInHostOS(
			`balena exec ${supervisorName} cat package.json | grep version`,
			uuid,
		);
		// The result takes the form - `"version": "12.3.5"` - so we must extract the version number
		supervisor = supervisor.split(' ');
		supervisor = supervisor[1].replace(`"`, ``);
		supervisor = supervisor.replace(`",`, ``);
		return supervisor;
	}

	/**
	 * Downloads provided version of balenaOS for the provided deviceType using balenaSDK
	 *
	 * @param version The semver compatible balenaOS version that will be downloaded, example: `2.80.3+rev1.dev`. Default value: `latest` where latest development variant of balenaOS will be downloaded.
	 * @param deviceType The device type for which balenaOS needs to be downloaded
	 * @remark Stores the downloaded image in `leviathan.downloads` directory,
	 * @throws Rejects promise if download fails. Retries thrice to download an image before giving up.
	 *
	 * @category helper
	 */
	async fetchOS(version = 'latest', deviceType: string) {
		// Caching implmentation if needed - Check https://github.com/balena-os/leviathan/issues/441
		// // Step 1: Find previously download balenaOS images in the Downlaods directory
		// glob(config.get('leviathan.downloads') + "balenaOs-*.img", (err, files) => {
		// 	if (err) {
		// 		throw err
		// 	}
		// 	files.forEach(async (file) => {
		// 		try {
		//			// Step 2: For each balenaOS image, we check and extract semver version using readOsRelease method
		//			// There is a step missing here with os class not being initialised for the image being checked.
		//			// Create an object of the os helpers class and use the readOsRelease() method to extract balenaOS version
		// 			let versionAvailable = await this.context.get().os.readOsRelease(file)
		// 			console.log(`verion found in the file is ${versionAvailable}`)

		// 			/**
		//			 * Using balena-semver, we compare versions and figure out if we need to download a new image or we already have one available in cache. 
		// 			 * The if condition returns 0 if versionA == versionB, or
		// 			 * 1 if versionA is greater, or
		// 			 * -1 if versionB is greater.
		// 			 * https://github.com/balena-io-modules/balena-semver#compareversiona-versionb--number
		// 			 */
		// 			if (semver.compare(versionAvailable, version) === 0) {
		// 				this.log(`[Cache used]`);
		// 				return path
		// 			} else {
		// 				console.log(`Deleting the file: ${file}`)
		// 				fse.unlinkSync(file)
		// 			}
		// 		} catch (err) {
		// 			// Image present might be corrupted, deleting...
		// 			fse.unlinkSync(file)
		// 		}
		// 	})
		// })

		const path = join(
			config.leviathan.downloads,
			`balenaOs-${version}.img`,
		);

		let attempt = 0;
		const downloadLatestOS = async () => {
			attempt++;
			console.log(
				`Fetching balenaOS version ${version}, attempt ${attempt}...`,
			);
			return await new Promise(async (resolve, reject) => {
				const stream = await this.balena.models.os.download(deviceType, version, { developmentMode: true })

				// Shows progress of image download for debugging purposes
				let progress = 0;
				stream.on('progress', (data: any) => {
					if (data.percentage >= progress + 10) {
						console.log(
							`Downloading balenaOS image: ${toInteger(data.percentage) + '%'
							}`,
						);
						progress = data.percentage;
					}
				});
				stream.pipe(fs.createWriteStream(path));
				stream.on('error', () => {
					fs.unlink(path, () => {
						// ignore 
					});
					reject(`Image download failed: ${JSON.stringify(stream)}`);
				})
				stream.on('finish', () => {
					console.log(`Download Successful: ${path}`);
					resolve(path);
				});

			});
		};
		return retry(downloadLatestOS, { max_tries: 3, interval: 500 });
	}
}
