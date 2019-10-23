# khook
Hooks/redirects tcp traffic from kubernetes service to your local machine

* Creates a jump pod in your current namespace with ssh reverse tunneling capability
* copies over your public ssh key to it (assumed to be ~/.ssh/id_rsa.pub)
* Replaces a service (given as cmd line argument) with one having the same port rules, but forwarding to the jump pod
* Spins up reverse ssh tunnels to facilitate tcp traffic flow from the jump pod to the local machine

When shutting down
* re-applies the original service configuration to the current namespace

*Warning: This program is a total duct tape dirty hack :), and one of the first node.js applications I ever wrote. For something more serious doing mostly the same thing, have a look at https://www.telepresence.io/*
