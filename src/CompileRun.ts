"use strict";

import { VSCodeUI } from "./VSCodeUI";
import { Constants } from "./Constants";
import { TextDocument, window, ConfigurationTarget, workspace } from "vscode";
import { Settings } from "./Settings";
import { commandExists } from "./CommandExists";
import { existsSync } from "fs";
import { join, parse, dirname, basename } from "path";
import { exec, spawn } from "child_process";
import { Run } from "./Run";

export class CompileRun {
    private outputChannel: VSCodeUI.CompileRunOutputChannel;
    private terminal: VSCodeUI.CompileRunTerminal;
    readonly Action: Constants.Action;

    constructor() {
        this.outputChannel = new VSCodeUI.CompileRunOutputChannel();
        this.terminal = VSCodeUI.compileRunTerminal;
    }

    private async compile(currentFile: TextDocument, outputFileName: string, doRun: boolean = false, withFlags: boolean = false) {
        let currentFileName = currentFile.fileName;

        if (Settings.saveBeforeCompile) {
            await window.activeTextEditor.document.save();
        }

        let exec;

        let compilerArgs = [currentFile.fileName, '-o', outputFileName];

        let compilerSetting: { path: string, args: string };
        let compilerSettingKey: { path: string, args: string };

        switch (currentFile.languageId) {
            case 'cpp': {
                compilerSetting = {
                    path: Settings.cppCompilerPath(),
                    args: Settings.cppCompilerArgs()
                };

                compilerSettingKey = {
                    path: Settings.key.cppCompilerPath,
                    args: Settings.key.cppCompilerArgs
                };
                break;
            }
            case 'c': {
                compilerSetting = {
                    path: Settings.cCompilerPath(),
                    args: Settings.cCompilerArgs()
                };
                compilerSettingKey = {
                    path: Settings.key.cCompilerPath,
                    args: Settings.key.cCompilerArgs
                };
                break;
            }
            default: {
                return;
            }
        }

        console.log(compilerSetting.path);
        if (!commandExists(compilerSetting.path)) {
            const CHANGE_PATH: string = "Change path";
            const choiceForDetails: string = await window.showErrorMessage("Compiler not found, try to change path in settings!", CHANGE_PATH);
            if (choiceForDetails === CHANGE_PATH) {
                let path = await this.promptForPath();
                await workspace.getConfiguration("c-cpp-compile-run", null).update(compilerSettingKey.path, path, ConfigurationTarget.Global);
                this.compile(currentFile, outputFileName, doRun, withFlags);
                return;
            }
            return;
        }
        if (withFlags) {
            let flagsStr = await this.promptForFlags(compilerSetting.args);
            if (flagsStr === undefined) { // cancel.
                return;
            }
            compilerArgs = compilerArgs.concat(flagsStr.split(" "));
        } else {
            compilerArgs = compilerArgs.concat(compilerSetting.args.split(" "));
        }

        console.log(compilerArgs.toString());
        exec = spawn(compilerSetting.path, compilerArgs);

        exec.stdout.on('data', (data: any) => {
            this.outputChannel.appendLine(data, currentFileName);
            this.outputChannel.show();
        });

        exec.stderr.on('data', (data: any) => {
            this.outputChannel.appendLine(data, currentFileName);
            this.outputChannel.show();
        });

        exec.on('close', (data: any) => {
            if (data === 0) {
                // Compiled successfully let's tell the user & execute
                window.showInformationMessage("Compiled successfuly!");
                if (doRun) {
                    this.run(outputFileName);
                }
            } else {
                // Error compiling
                window.showErrorMessage("Error compiling!");
            }
        });
    }

    private async run(outputFile: string, withArgs: boolean = false) {
        if (!existsSync(outputFile)) {
            window.showErrorMessage(`"${outputFile}" doesn't exists!`);
            return;
        }

        let runArgs = Settings.runArgs();
        if (withArgs) {
            let argsStr = await this.promptForRunArgs(Settings.runArgs());
            if (argsStr === undefined) { // cancel.
                return;
            }
            runArgs = argsStr;
        }

        // let command = `'${outputFile}' ${runArgs}`;
        let run = new Run(basename(outputFile), dirname(outputFile), runArgs);

        if (Settings.runInExternalTerminal()) {
            if (!this.runExternal(run)) {
                this.terminal.runInTerminal(run.get_executable_with_args(), { cwd: run.get_directory() });
            }
        } else {
            this.terminal.runInTerminal(run.get_executable_with_args(), { cwd: run.get_directory() });
        }
    }

    public async compileRun(action: Constants.Action) {
        let currentFile = window.activeTextEditor.document;

        if (!currentFile) {
            return;
        }

        let outputFile = join(parse(currentFile.fileName).dir, parse(currentFile.fileName).name);
        if (process.platform === 'win32') {
            outputFile = outputFile + '.exe';
        }

        switch (action) {
            case Constants.Action.Compile:
                this.compile(currentFile, outputFile);
                break;
            case Constants.Action.Run:
                this.run(outputFile);
                break;
            case Constants.Action.CompileRun:
                this.compile(currentFile, outputFile, true);
                break;
            case Constants.Action.CompileWithFlags:
                this.compile(currentFile, outputFile, false, true);
                break;
            case Constants.Action.RunWithArguments:
                this.run(outputFile, true);
                break;
            default: return;
        }
    }

    private async promptForFlags(defaultFlags: string): Promise<string | undefined> {
        try {
            return await window.showInputBox({
                prompt: 'Flags',
                placeHolder: '-Wall -Wextra',
                value: defaultFlags
            });
        } catch (e) {
            return null;
        }
    }

    private async promptForRunArgs(defaultArgs: string): Promise<string | undefined> {
        try {
            return await window.showInputBox({
                prompt: 'Arguments',
                value: defaultArgs
            });
        } catch (e) {
            return null;
        }
    }

    private async promptForPath(): Promise<string | undefined> {
        try {
            return await window.showInputBox({
                prompt: 'Path',
                placeHolder: '/usr/bin/gcc'
            });
        } catch (e) {
            return null;
        }
    }

    private runExternal(run: Run): boolean {
        switch (process.platform) {
            case "win32":
                exec(`start cmd /c "${run.get_executable} ${run.get_args()} & echo. & pause"`, { cwd: run.get_directory() });
                return true;
            case "linux":
                if (commandExists('gnome-terminal')) {
                    exec(`gnome-terminal -t ${run.get_executable()} -x bash -c './${run.get_executable()} ${run.get_args()} ; echo; read -n1 -p "Press any key to continue..."'`, { cwd: run.get_directory() });
                    return true;
                } else if (commandExists('xterm')) {
                    exec(`xterm -T ${run.get_executable()} -e './${run.get_executable()} ${run.get_args()} ; echo; read -n1 -p "Press any key to continue..."'`, { cwd: run.get_directory() });
                    return true;
                }
                return false;
            case "darwin":
                exec(`osascript - e 'tell application "Terminal" to do script "./${run.get_executable()} && read -n1 -p "Press any key to continue...""'`, { cwd: run.get_directory() });
                return true;
        }
        return false;
    }
}