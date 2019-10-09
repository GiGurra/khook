# khook
Temporarily hook inbound/outbound traffic of a kubernetes service to your local development machine


IDEA:


desired outcome:

	* Be able to execue application locally, and have it injected into a kubernetes cluster so it 
	received incoming network traffic, and also can send network traffic out to other services in that cluster.
	Local development dream :).


desired api:

	bash|$	kube-inject	inject.yml
	

inject.yml:

	target: <service name>
	inbound:
		- local: 12345
		  remote: 9000
		- local: 54321
		  remote: 8000
	outbound:
		- local: 1111
		  remote:
			service: x
			port: 9000
		- local: 2222
		  remote:
			service: y
			port: 9000


-----------------

implementation

	1. spin up injector in cluster: a name-randomized pod or sts/deploy with ssh daemon
	2. make backup of existing service in kubernetes config (and local yaml config backup as well)
	3. replace kubernetes service (discovery) definition and route all ports to injector
	4. use kubectl port-forward to forward local port (randomized) to injector ssh port
	5. For each outbound rule: set up ssh tunnel: ssh -L <outbound.local>:<target service>:<target service port> <user>@localhost -p <local forwarded from step 4>
	6. For each inbound rule: set up reverse ssh tunnel: ssh -R <service port>:localhost:<local port> <user>@localhost -p <local forwarded from step 4>
	7. PROFIT!!!!!
	
	
on-exit: 
1. revert service definition to backed up config
2. shut down injector
3. kill all forwarding rules

if crashed: 
* print command to explain how to do 1+2 of the above



