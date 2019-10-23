#!/usr/bin/env node

// std lib dependencies
const childProc = require('child_process');
const fs = require("fs");

// external dependencies
const yaml = require('js-yaml');
const isPortReachable = require('is-port-reachable');
const dateFormat = require('dateformat');
const findFreePort = require("find-free-port");
const yargs = require('yargs/yargs');

// globals used during cleanup
const globalState = {
    startTime: new Date(),
    backupDir: "backed-up-resources",
    createDir: "created-resources",
    serviceName: null,
    hookPodName: null,
    serviceReplaced: false,
    hookPodDeployed: false,
    serviceBackupFilePath: function () {
        return this.backupDir + "/" + this.serviceName + "--" + dateFormat(this.startTime, "yyyymmdd-HHMMss") + ".bak.yml"
    }
};

// main fcn
async function main() {

    // Set cleanup
    process.on('SIGINT', () => { cleanup(); process.exit(0) });

    const cmdLine = parseCmdLine(); // for the time we need it and decide to implement some options

    // Parse input
    const configFilePathOrService = cmdLine['service-name'];
    const killOriginalPod = cmdLine['kill-original-pod'];
    const hookConfig = await generateConfigFromService(configFilePathOrService);
    hookConfig.localSshPort = (await findFreePort(2000))[0];

    const serviceName = hookConfig.target;
    const localSshPort = hookConfig.localSshPort;
    globalState.serviceName = serviceName;

    // Other config
    const hookImage = "gigurra/khook:1.0.0";

    // Get original service definition, and check it
    const originalServiceConf = getServiceConf(serviceName);
    delete originalServiceConf.metadata.resourceVersion;
    const serviceSelectorLabels = originalServiceConf.spec.selector;
    const serviceSelectorLabelKeys = Object.keys(serviceSelectorLabels);
    if (serviceSelectorLabelKeys.length <= 0) {
        throw new Error("Cannot hook service '" + serviceName + "' because the original service's selector has no labels")
    }

    // The kubernetes configuration of our hook pod
    const hookPodName = serviceName + "-hook";
    globalState.hookPodName = hookPodName;
    const hookPodConfig = {
        apiVersion: "v1",
        kind: "Pod",
        metadata: {
            name: hookPodName,
            labels: {
                name: hookPodName
            },
            resourceVersion: Math.floor(Math.random() * Math.floor(100000)).toString() // ensures we cannot deploy over an existing hook pod
        },
        spec: {
            containers: [{
                name: hookPodName,
                image: hookImage
            }]
        }
    };

    // The kubernetes configuration of our hook service
    const hookServiceConf = JSON.parse(JSON.stringify(originalServiceConf));
    delete hookServiceConf.metadata.annotations["field.cattle.io/targetWorkloadIds"];
    delete hookServiceConf.metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"];
    delete hookServiceConf.metadata.annotations["workload.cattle.io/targetWorkloadIdNoop"];
    delete hookServiceConf.metadata.annotations["workload.cattle.io/workloadPortBased"];
    delete hookServiceConf.metadata["creationTimestamp"];
    delete hookServiceConf.metadata.labels["cattle.io/creator"];
    delete hookServiceConf.metadata["ownerReferences"];
    delete hookServiceConf.metadata["selfLink"];
    delete hookServiceConf.metadata["uid"];
    delete hookServiceConf.status;
    hookServiceConf.spec.selector = { name: hookPodName };

    // Check that no hook pod already exists
    const currentPods = yaml.safeLoad(childProc.execSync("kubectl get pods -o yaml").toString());
    if (currentPods.items.find(p => p.metadata.name === hookPodName)) {
        throw new Error("[ALREADY EXISTS] Pod with name '" + hookPodName + "' already exists. Shut this down first before trying khook again")
    }

    // Create backup and new definition directories if they don't exist
    const backupDir = globalState.backupDir;
    const createDir = globalState.createDir;

    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir)
    }
    if (!fs.existsSync(createDir)) {
        fs.mkdirSync(createDir)
    }

    // Back up previous service definition
    fs.writeFileSync(globalState.serviceBackupFilePath(), yaml.safeDump(originalServiceConf));

    // Write new service and pod definition
    fs.writeFileSync(createDir + "/" + serviceName + ".yml", yaml.safeDump(hookServiceConf));
    fs.writeFileSync(createDir + "/" + hookPodName + ".yml", yaml.safeDump(hookPodConfig));

    // Deploy the pod
    console.log("deploying hook pod ...");
    childProc.execSync("kubectl apply -f " + createDir + "/" + hookPodName + ".yml");
    globalState.hookPodDeployed = true;
    globalState.hookPodName = hookPodName;

    // Wait for hook pod to reach state running in kubernetes
    await waitForPodToReachStateRunning(hookPodName);

    // copy over ssh public keys..
    console.log("Copying over ssh public key to hook pod ...");
    childProc.execSync("kubectl cp ~/.ssh/id_rsa.pub " + hookPodName + ":/root/.ssh/authorized_keys");
    childProc.execSync("kubectl exec " + hookPodName + " chown root:root /root/.ssh/authorized_keys");

    // Set up port forward for ssh connections
    console.log("setting up local port " + localSshPort + " to forward ssh traffic to hook pod  ...");
    const portForwardProc = childProc.spawn("kubectl", ["port-forward", hookPodName, localSshPort + ":22"]);
    portForwardProc.stdout.on('data', data => { console.log(data.toString()) });
    portForwardProc.stderr.on('data', data => { console.error(data.toString()) });

    // Wait for port forwarding some time to become active
    await waitForKubectlSshTunnelToBecomeActive(localSshPort);

    // Set up the reverse tunnels (inbound data)
    const inboundRules = hookConfig.inbound;
    for (const rule of inboundRules) {
    
        console.log("setting up inbound traffic redirect:" + JSON.stringify(rule));

        const ruleProc = childProc.spawn("ssh", ["-oStrictHostKeyChecking=no", "-oBatchMode=yes", "-f", "-N", "-R", rule.remote + ":localhost:" + rule.local, "root@localhost", "-p", localSshPort]);
        ruleProc.stdout.on('data', data => { console.log(data.toString()) });
        ruleProc.stderr.on('data', data => { console.error(data.toString()) })
    }

    // Set up the direct tunnels (outbound data)
    console.log("TODO: Implement outbound tunnels");

    // Reconfigure kubernetes service object
    console.log("redirecting traffic by rewriting kubernetes service object ...");
    childProc.execSync("kubectl apply -f " + createDir + "/" + serviceName + ".yml");
    globalState.serviceReplaced = true;
    globalState.serviceName = serviceName;

    // Delete existing target pods make sure all clients reconnect through the new service definition
    if (killOriginalPod) {
        console.log("Deleting existing pods targeted by original service, based on label: " + JSON.stringify(serviceSelectorLabels));
        let labelFilterString = "";
        for (const serviceSelectorLabelKey of serviceSelectorLabelKeys) {
            labelFilterString = labelFilterString.concat(" -l " + serviceSelectorLabelKey + "=" + serviceSelectorLabels[serviceSelectorLabelKey])
        }
        const killOldPodsCommand = "kubectl delete pods " + labelFilterString + " --wait=false";
        childProc.execSync(killOldPodsCommand);
    }

    console.log('HOOK DEPLOYED! Press ctrl+c/send sigint to exit')

}

async function generateConfigFromService(serviceName) {

    console.log("Checking what ports that should be forwarded from remote to local machine ...");

    const serviceConf = getServiceConf(serviceName);

    const out = {
        target: serviceName,
        inbound: []
    };

    for (const portCfg of serviceConf.spec.ports) {
        const port = portCfg.targetPort;
        out.inbound.push({
            remote: port,
            local: port
        });
    }

    return out;
}

function getServiceConf(serviceName) {
    return yaml.safeLoad(childProc.execSync("kubectl get service " + serviceName + " -o yaml").toString());
}

function cleanup() {

    try {

        if (globalState.serviceReplaced) {
            console.log("restoring original service '" + globalState.serviceName + "'");
            childProc.execSync("kubectl apply -f " + globalState.serviceBackupFilePath())
        }

        if (globalState.hookPodDeployed) {
            console.log("deleting hook pod '" + globalState.hookPodName + "' (with --wait=false)");
            childProc.execSync("kubectl delete pod " + globalState.hookPodName + " --wait=false")
        }

    } catch (error) {
        console.error("cleanup failed due to: " + error)
    }
}

async function waitForKubectlSshTunnelToBecomeActive(localSshPort) {

    const success = await waitFor(
        async () => {
            return isPortReachable(localSshPort)
        },
        15000,
        500,
        "Waiting for local hssh port '" + localSshPort + "' to become reachable ..."
    );

    if (!success) {
        throw new Error("ssh tunnel did not open within allowed time")
    }

}

async function waitForPodToReachStateRunning(hookPodName) {

    const success = await waitFor(
        async () => {

            const currentPodState = yaml.safeLoad(childProc.execSync("kubectl get pod " + hookPodName + " -o yaml"));

            return currentPodState &&
                currentPodState.status &&
                currentPodState.status.containerStatuses &&
                currentPodState.status.containerStatuses[0] &&
                currentPodState.status.containerStatuses[0].state &&
                currentPodState.status.containerStatuses[0].state.running &&
                currentPodState.status.containerStatuses[0].state.running.startedAt

        },
        60000,
        500,
        "Waiting for hook pod '" + hookPodName + "' to reach state Running ..."
    );

    if (!success) {
        throw new Error("Hook pod never reached running state")
    }
}

async function waitFor(test, maxMillis, interval, message) {

    let iAttempt = 0;
    let maxAttempts = maxMillis / interval;
    let success = false;

    while (!success && iAttempt < maxAttempts) {

        console.log(message);

        success = await test();

        if (!success) {
           await new Promise(done => setTimeout(done, interval));
        }

        iAttempt = iAttempt + 1
    }

    return success
}

function parseCmdLine() {
    // someone who knows yargs can prob improve on this :S.
    return yargs(process.argv.slice(2)).usage(
        '$0 [options] <service-name>',
        'Hooks/Steals tcp traffic from an existing kubernetes service and sends it to your computer',
        (yargs) => {
            yargs
                .example("$0 test-service  ",
                    "Hooks traffic to service 'test-service' from current kubernetes namespace and sends it to your computer"
                )
                .option('kill-original-pod', {
                    alias: 'k',
                    description: 'Kills the original target of the service, after the hook has been successfully deployed (useful for existing in-cluster clients to immediately redirect traffic)',
                    type: 'boolean',
                    default: false
                })
                .strict()
        }).argv;
}

main().catch(error => {
    console.error(error);
    cleanup();
    process.exit(1)
});
