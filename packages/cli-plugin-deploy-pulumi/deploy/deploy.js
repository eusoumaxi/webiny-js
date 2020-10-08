const { join, basename } = require("path");
const { green } = require("chalk");
const notifier = require("node-notifier");
const { Pulumi } = require("@webiny/pulumi-sdk");
const path = require("path");
const execa = require("execa");
const ProgressBar = require("progress");
const getPackages = require("get-yarn-workspaces");
const ora = require("ora");

const notify = ({ message }) => {
    notifier.notify({
        title: "Webiny CLI",
        message,
        icon: join(__dirname, "logo.png"),
        sound: false,
        wait: true
    });
};

const sleep = () => {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve();
        }, 1000);
    });
};

const getStackName = folder => {
    folder = folder.split("/").pop();
    return folder === "." ? basename(process.cwd()) : folder;
};

const processHooks = async (hook, { context, ...options }) => {
    const plugins = context.plugins.byType(hook);

    for (let i = 0; i < plugins.length; i++) {
        try {
            await plugins[i].hook(options, context);
        } catch (err) {
            console.log(`🚨 Hook ${green(plugins[i].name)} encountered an error: ${err.message}`);
        }
    }
};

module.exports = async ({ options, ...inputs }, context) => {
    const start = new Date();
    const getDuration = () => {
        return (new Date() - start) / 1000;
    };

    const { env, folder, debug = true } = inputs;
    const stack = getStackName(folder);

    const projectRoot = context.paths.projectRoot;

    // Load .env.json from project root.
    await context.loadEnv(path.resolve(projectRoot, ".env.json"), env, { debug });

    // Load .env.json from cwd (this will change depending on the folder you specified).
    await context.loadEnv(path.resolve(projectRoot, folder, ".env.json"), env, { debug });

    if (inputs.build) {
        const packages = getPackages().filter(item =>
            item.includes(path.join(process.cwd(), folder))
        );

        console.log(
            `⏳ Building ${packages.length} package(s) in ${green(
                path.join(process.cwd(), folder)
            )}...`
        );
        const bar = new ProgressBar("[:bar] :percent :etas", {
            complete: "=",
            incomplete: " ",
            width: 1024,
            total: packages.length
        });

        const promises = [];
        for (let i = 0; i < packages.length; i++) {
            promises.push(
                new Promise(async (resolve, reject) => {
                    try {
                        const cwd = packages[i];
                        await execa("yarn", ["build"], { cwd });
                        bar.tick();

                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                })
            );
        }

        await Promise.all(promises);
    }

    const stacksDir = path.join(".", folder);

    let spinner = new ora();
    const pulumi = new Pulumi({
        execa: {
            cwd: stacksDir,
            env: { PULUMI_CONFIG_PASSPHRASE: process.env.PULUMI_CONFIG_PASSPHRASE }
        },
        args: {
            secretsProvider: "passphrase"
        },
        beforePulumiInstall: () => {
            console.log(
                `💡 It looks like this is your first time using ${green("@webiny/pulumi-sdk")}.`
            );
            spinner.start(`Downloading Pulumi...`);
        },
        afterPulumiInstall: () => {
            spinner.stopAndPersist({
                symbol: green("✔"),
                text: `Pulumi downloaded, continuing...`
            });
        }
    });

    let stackExists = true;
    try {
        const { process } = await pulumi.run({ command: ["stack", "select", env] });
        await process;
    } catch (e) {
        stackExists = false;
    }

    if (!stackExists) {
        const { process: pulumiProcess } = await pulumi.run({ command: ["stack", "init", env] });
        await pulumiProcess;

        // We need to add an arbitrary "aws:region" config value, just because Pulumi something to be there.
        // @sse https://github.com/pulumi/pulumi-aws/issues/1153
        const pulumiConfig = new Pulumi({
            execa: {
                cwd: stacksDir,
                env: { PULUMI_CONFIG_PASSPHRASE: process.env.PULUMI_CONFIG_PASSPHRASE }
            },
        });

        const { process: configProcess } = await pulumiConfig.run({
            command: ["config", "set", "aws:region", process.env.AWS_REGION]
        });
        await configProcess;
    }

    const isFirstDeploy = !stackExists;

    const hookDeployArgs = { isFirstDeploy, context, env, stack };

    if (inputs.preview) {
        console.log(`Skipped "hook-before-deploy" hook.`);
    } else {
        spinner = spinner.start(`Running "hook-before-deploy" hook...`);
        await processHooks("hook-before-deploy", hookDeployArgs);
        await sleep();

        const continuing = inputs.preview ? `Previewing stack...` : `Deploying stack...`;
        spinner.stopAndPersist({
            symbol: green("✔"),
            text: `Hook "hook-before-deploy" completed. ${continuing}\n`
        });
    }

    if (inputs.preview) {
        const pulumi = new Pulumi();
        const { toConsole } = await pulumi.run({
            command: "preview",
            execa: {
                cwd: stacksDir,
                env: { PULUMI_CONFIG_PASSPHRASE: process.env.PULUMI_CONFIG_PASSPHRASE }
            }
        });
        await toConsole();
    } else {
        const { toConsole } = await pulumi.run({
            command: "up",
            args: {
                yes: true,
                skipPreview: true
            }
        });
        await toConsole();
    }

    const duration = getDuration();
    if (inputs.preview) {
        console.log(`\n🎉 Done! Preview finished in ${green(duration + "s")}.\n`);
    } else {
        console.log(`\n🎉 Done! Deploy finished in ${green(duration + "s")}.\n`);
        notify({ message: `"${folder}" stack deployed in ${duration}s.` });
    }

    if (inputs.preview) {
        console.log(`Skipped "hook-after-deploy" hook.`);
    } else {
        spinner = spinner.start(`Running "hook-after-deploy" hook...`);
        await processHooks("hook-after-deploy", hookDeployArgs);
        await sleep();
        spinner.stopAndPersist({
            symbol: green("✔"),
            text: `Hook "hook-after-deploy" completed.`
        });
    }
};