/**
 * # Worker helpers
 *
 * The worker class can be used to control the testbot hardware. In the `suite.js` file, you can
 * create an instance of it, and then use its methods to flash the DUT, power it on/off, and set up a
 * network AP for the DUT to connect to.
 *
 * @example
 * ```js
 *  const Worker = this.require('common/worker');
 *  this.suite.context.set({
 *      worker: new Worker(DEVICE_TYPE_SLUG, this.getLogger()), // Add an instance of worker to the context
 *  });
 *  const Worker = this.require('common/worker');
 *  const worker = new Worker(DEVICE_TYPE_SLUG, this.getLogger())
 * ```
 * @module Leviathan Worker helpers
 */

import retry from 'bluebird-retry';
import request from 'request';
import rp from 'request-promise';
import { fs } from 'mz';
import * as Stream from 'stream';
import { once, isNumber } from 'lodash';
import { promisify } from 'util';
import * as Child_Process from 'child_process';
import { Utils } from './utils';

const pipeline = promisify(Stream.pipeline);
const exec = promisify(Child_Process.exec);

const utils = new Utils();

// const Archiver = require('../common/archiver');
// const config = require('config');

export class Worker {
	private deviceType: string;
	private url: string;
	private logger: any;

	constructor(
		deviceType: string,
		logger = { log: console.log, status: console.log, info: console.log },
		url = 'http://127.0.0.1:2000',
	) {
		this.deviceType = deviceType;
		this.url = url;
		this.logger = logger;
	}

	async getDeviceType() {
		console.log(this.deviceType);
	}
	/**
	 * Flash the provided OS image onto the connected DUT
	 *
	 * @param {string} imagePath path of the image to be flashed onto the DUT
	 *
	 * @category helper
	 */
	async flash(imagePath: string) {
		this.logger.log('Preparing to flash');

		await new Promise<void>(async (resolve, reject) => {
			let lastStatus: string;
			const req = rp.post({ uri: `${this.url}/dut/flash` });

			req.catch((error) => {
				reject(error);
			});
			req.finally(() => {
				if (lastStatus !== 'done') {
					reject(new Error('Unexpected end of TCP connection'));
				}

				resolve();
			});

			req.on('data', (data) => {
				const computedLine = RegExp('(.+?): (.*)').exec(data.toString());

				if (computedLine) {
					if (computedLine[1] === 'error') {
						req.cancel();
						reject(new Error(computedLine[2]));
					}

					if (computedLine[1] === 'progress') {
						once(() => {
							this.logger.log('Flashing');
						});
						// Hide any errors as the lines we get can be half written
						const state = JSON.parse(computedLine[2]);
						if (state != null && isNumber(state.percentage)) {
							this.logger.status({
								message: 'Flashing',
								percentage: state.percentage,
							});
						}
					}

					if (computedLine[1] === 'status') {
						lastStatus = computedLine[2];
					}
				}
			});

			await pipeline(fs.createReadStream(imagePath), req);
		});
		this.logger.log('Flash completed');
	}

	/**
	 * Turn the DUT on
	 *
	 * @category helper
	 */
	async on() {
		this.logger.log('Powering on DUT');
		await rp.post(`${this.url}/dut/on`);
		this.logger.log('DUT powered on');
	}

	/**
	 * Turn the DUT off
	 *
	 * @category helper
	 */
	async off() {
		this.logger.log('Powering off DUT');
		await rp.post(`${this.url}/dut/off`);
	}

	// enforce a stricter typing - find out what this function should accept
	async network(network: any) {
		await rp.post({
			uri: `${this.url}/dut/network`,
			body: network,
			json: true,
		});
	}
	// enforce a stricter typing - find out what this function should accept
	proxy(proxy: any) {
		return rp.post({ uri: `${this.url}/proxy`, body: proxy, json: true });
	}

	ip(
		target: string,
		timeout = {
			interval: 10000,
			tries: 60,
		},
	) {
		return /.*\.local/.test(target)
			? retry(
					() => {
						return rp.get({
							uri: `${this.url}/dut/ip`,
							body: { target },
							json: true,
						});
					},
					{
						max_tries: timeout.tries,
						interval: timeout.interval,
						throw_original: true,
					},
			  )
			: target;
	}

	async teardown() {
		await rp.post({ uri: `${this.url}/teardown`, json: true });
	}

	capture(action: string) {
		switch (action) {
			case 'start':
				return rp.post({ uri: `${this.url}/dut/capture`, json: true });
			case 'stop':
				return request.get({ uri: `${this.url}/dut/capture` });
		}
	}

	/**
	 * Executes command-line operations in the host OS of the DUT. Assuming the DUT is
	 * connected to the access point broadcasted by the testbot:
	 *
	 * @example
	 * ```js
	 * const Worker = this.require('common/worker');
	 * const worker = new Worker(DEVICE_TYPE_SLUG, this.getLogger())
	 * await worker.executeCommandInHostOS('cat /etc/hostname', `${UUID}.local`);
	 * ```
	 *
	 * @param {string} command command to be executed on the DUT
	 * @param {string} target local UUID of the DUT, example:`${UUID}.local`
	 * @param {{"interval": number, "tries": number}} timeout object containing details of how many times the
	 * command needs to be retried and the intervals between each command execution
	 * @returns {string} Output of the command that was exected on hostOS of the DUT
	 *
	 * @category helper
	 */
	async executeCommandInHostOS(
		command: string,
		target: string,
		timeout = {
			interval: 10000,
			tries: 10,
		},
	) {
		const ip = /.*\.local/.test(target) ? await this.ip(target) : target;

		return retry(
			async () => {
				const result = await utils.executeCommandOverSSH(
					`source /etc/profile ; ${command}`,
					{
						host: ip,
						port: '22222',
						username: 'root',
					},
				);

				if (typeof result.code === 'number' && result.code !== 0) {
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
	 * Pushes a release to an application from a given directory for unmanaged devices
	 *
	 * @param {string} target  the <UUID> for the target device
	 * @param {string} source The path to the directory containing the docker-compose/Dockerfile for the containers
	 * @param {string} containerName The name of the container to verify is push has succeeded.
	 * @returns {string} returns state of the device
	 *
	 * @category helper
	 */
	async pushContainerToDUT(
		target: string,
		source: string,
		containerName: string,
	) {
		await retry(
			async () => {
				await exec(
					`balena push ${target} --source ${source} --nolive --detached`,
				);
			},
			{
				max_tries: 10,
				interval: 5000,
			},
		);
		// now wait for new container to be available
		let state: any = {};
		await utils.waitUntil(async () => {
			state = await rp({
				method: 'GET',
				uri: `http://${target}:48484/v2/containerId`,
				json: true,
			});

			return state.services[containerName] != null;
		}, false);

		return state;
	}

	/**
	 * Executes the command in the targeted container of a device
	 * @param {string} command The command to be executed
	 * @param {string} containerName The name of the service/container to run the command in
	 * @param {*} target The `<UUID.local>` of the target device
	 * @returns {string} output of the command that is executed on the targetted container of the device
	 * @category helper
	 */
	async executeCommandInContainer(
		command: string,
		containerName: string,
		target: string,
	) {
		// get container ID
		const state = await rp({
			method: 'GET',
			uri: `http://${target}:48484/v2/containerId`,
			json: true,
		});

		const stdout = await this.executeCommandInHostOS(
			`balena exec ${state.services[containerName]} ${command}`,
			target,
		);
		return stdout;
	}

	/**
	 * Triggers a reboot on the target device and waits until the device comes back online
	 *
	 * @param {string} target
	 * @category helper
	 */
	async rebootDut(target: string) {
		this.logger.log(`Rebooting the DUT`);
		await this.executeCommandInHostOS(
			`touch /tmp/reboot-check && systemd-run --on-active=2 reboot`,
			target,
		);
		await utils.waitUntil(async () => {
			return (
				(await this.executeCommandInHostOS(
					'[[ ! -f /tmp/reboot-check ]] && echo pass',
					target,
				)) === 'pass'
			);
		}, false);
		this.logger.log(`DUT has rebooted & is back online`);
	}

	/**
	 * Fetches OS version available on the DUT's `/etc/os-release` file
	 *
	 * @param {string} target
	 * @returns {string} returns OS version
	 * @category helper
	 */
	async getOSVersion(target: string) {
		// maybe https://github.com/balena-io/leviathan/blob/master/core/lib/components/balena/sdk.js#L210
		// will do? that one works entirely on the device though...
		const output: any = await this.executeCommandInHostOS(
			'cat /etc/os-release',
			target,
		);
		let match = '';
		output.split('\n').every((x: any) => {
			if (x.startsWith('VERSION=')) {
				match = x.split('=')[1];
				return false;
			}
			return true;
		});
		return match.replace(/"/g, '');
	}

	/**
	 * Helper to archive journal logs to be used in the suite teardown
	 *
	 * @param {*} target
	 * @category helper
	 */
	/*async archiveLogs(target) {
		this.logger.log(`Retreiving journal logs...`);
		try {
			const journal = await this.executeCommandInHostOS(
				`journalctl --no-pager -a -b all`,
				target,
			);
			const journalLogsPath = '/tmp/journal.log';
			fs.writeFileSync(journalLogsPath, journal);
			await Archiver.add(journalLogsPath);
		} catch (e) {
			this.logger.log(`Couldn't retrieve journal logs with error ${e}`);
		}
	}*/
}
