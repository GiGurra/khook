# khook
Hooks/redirects tcp traffic from kubernetes service to your local machine. Useful when you want to test and/or debug things, without having to go through a full CI pipeline and deploy to the cluster. 

Quick and dirty hack. Don't expect pretty code :).

When deployed:
* Creates a jump pod in your current namespace with ssh reverse tunneling capability
* Copies over your public ssh key to it (assumed to be `~/.ssh/id_rsa.pub`)
* Makes a copy of the Service conf (as a yaml file) in `~/.khook/backed-up-resources/<svcname>-timestamp.yml`
* Replaces the service conf with one having the same port rules, but forwarding to the jump pod
* Spins up reverse ssh tunnels to facilitate tcp traffic flow from the jump pod to the local machine

When shutting down:
* Re-applies the original service configuration to the current namespace
* Deletes the jump pod

*Warning 1: This program is a total duct tape dirty hack :), and one of the first node.js applications I ever wrote (some of the first js code I ever wrote). For something more serious doing mostly the same thing, have a look at https://www.telepresence.io/*

*Warning 2: If you lose connection to your cluster before shutting dow the app - tough luck! The service conf exists only on your machine and your cluster is now in a fubar state. khook may implement an in-cluster conf backup function eventually.*

### Howto

```
╰─>$ khook --help
khook [options] <service-name>

Hooks/Steals tcp traffic from an existing kubernetes service and sends it to
your computer

Options:
 --help                   Show help                                   [boolean]
 --version                Show version number                         [boolean]
 --kill-original-pod, -k  Kills the original target of the service, after the
                          hook has been successfully deployed (useful for
                          existing in-cluster clients to immediately redirect
                          traffic)                   [boolean] [default: false]

Examples:
 khook test-service    Hooks traffic to service 'test-service' from current
                       kubernetes namespace and sends it to your computer
```
