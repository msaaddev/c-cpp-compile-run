import * as cp from 'child_process';
import * as vscode from 'vscode';
import { outputChannel } from '../output-channel';

export async function executeCommand(command: string, args: string[], options: cp.SpawnOptions = { shell: true }): Promise<string> {
    return new Promise((resolve: (res: string) => void, reject: (e: Error) => void): void => {
        outputChannel.appendLine(`${command}, [${args.join(',')}]`);
        let result = '';
        const childProc: cp.ChildProcess = cp.spawn(command, args, options);
        childProc.stdout.on('data', (data: string | Buffer) => {
            data = data.toString();
            result = result.concat(data);
        });
        childProc.on('error', reject);
        childProc.on('close', (code: number) => {
            if (code !== 0 || result.indexOf('ERROR') > -1) {
                reject(new Error(`Command "${command} ${args.toString()}" failed with exit code "${code}".`));
            } else {
                resolve(result);
            }
        });
    });
}

export async function executeCommandWithProgress(
    message: string, command: string, args: string[], options: cp.SpawnOptions = { shell: true }
): Promise<string> {
    let result = '';
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, async (p: vscode.Progress<{}>) => {
        outputChannel.appendLine(`${command}, [${args.join(',')}]`);
        return new Promise(async (resolve: () => void, reject: (e: Error) => void): Promise<void> => {
            p.report({ message });
            try {
                result = await executeCommand(command, args, options);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
    return result;
}
