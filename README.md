# khook
Hooks/redirects tcp traffic from kubernetes service to your local machine

* Creates a jump pod in your current namespace with ssh reverse tunneling capability
* copies over your public ssh key to it (assumed to be `~/.ssh/id_rsa.pub`)
* Makes a copy of the Service conf (as a yaml file) in `<cwd>/backed-up-resources/<svcname>-timestaml.yml`
* Replaces the service conf with one having the same port rules, but forwarding to the jump pod
* Spins up reverse ssh tunnels to facilitate tcp traffic flow from the jump pod to the local machine

When shutting down
* re-applies the original service configuration to the current namespace

*Warning 1: This program is a total duct tape dirty hack :), and one of the first node.js applications I ever wrote. For something more serious doing mostly the same thing, have a look at https://www.telepresence.io/*

*Warning 2: If you lose connection to your cluster before shutting dow the app - tough luck! The service conf exists only on your machine and your cluster is now in a fubar state. khook may implement an in-cluster conf backup function eventually.
