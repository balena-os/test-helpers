/**
 * # Preload
 * 
 * Use this helper to preload images: https://www.balena.io/docs/reference/balena-cli/#preload-image
 * 
 * @module Preload
 */

/* Copyright 2021 balena
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
import { spawn } from 'child_process';

/**
 * Preload the image onto the target image
 *
 * @param {string} image path to the image
 * @param {app: string, commit: string, pin: boolean} options options to be executed with balena preload command
 *
 * @category helper
 */
export async function preload(
    image: string,
    options: { app: string, commit: string, pin: boolean }
): Promise<void> {
    console.log('--Preloading image--');
    console.log(`Image path: ${image}`);
    console.log(`Fleet: ${options.app}`);
    console.log(`Commit: ${options.commit}`);

    await new Promise<void>((resolve, reject) => {
        const child = spawn(
            'balena',
            [
                `preload ${image} --fleet ${options.app} --commit ${options.commit
                } ${options.pin ? '--pin-device-to-release ' : ''}`,
                '--debug'
            ],
            {
                stdio: 'inherit',
                shell: true,
            },
        );

        function handleSignal(signal: any) {
            child.kill(signal);
        }

        process.on('SIGINT', handleSignal);
        process.on('SIGTERM', handleSignal);
        child.on('exit', (code) => {
            process.off('SIGINT', handleSignal);
            process.off('SIGTERM', handleSignal);
            if (code === 0) {
                resolve();
            } else {
                reject()
            }
        });
        child.on('error', (err) => {
            process.off('SIGINT', handleSignal);
            process.off('SIGTERM', handleSignal);
            reject(err);
        });
    });
}

