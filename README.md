# Shelly load shedder

A general shelly load shedding script

(C) Jonas Bjurel et Al.

License: Apache 2 

## Purpose, principles and use cases:
The purpose of this Shedding script is to provide means to control current drawing through group fuses, grid termination points, etc., such that unnecessary fuse shedding happens or excessive grid cost is charged for due to high current draw, and even control the power draw at forcasted high cost periods.

The shedder script provide means to support multiple use-cases one by one, or in combination.
The script can work in atonomous shedding mode, measuring and shedding channels on the local shelly device it is running on. The script can also control a distributed setup, controlling a set of remote shelly devices all participating in a shedding group. Finally the script may also participate in a larger loadbalancing setup aimed to control the grid current and power draw such that unnecessarry current peaks occur - potentially resulting penalty fees, or excessive energy bills at high cost periods.

The shedder script manages a single phase only, 3 separate script instances can be deployed to manage a 3 phase system. If so, there is no coordination between the script instances and the applicability to manage 2-, or 3-phase loads is questionable unless cautionably analysis have been conducted. It is not recommended to manage 3-phase motor loads at all since it the phase disconnect asynchrounusly could destroy the motor or trip the motor protection (3-phase pumps, 3-phase heat-pumps, etc.)

### Protecting a single phase group fuse from tripping in atonomous mode.
There are many occations where a group fuse can not be dimentioned for all the potential loads connected to it, this can because the feed cabling is not dimentioned for higher fuse ratings, because of the cost of higher rated grid fuses, or otherwise. Shedding is a technique that controls the current through a fuse by disconnecting low priority loads when needed to not trip the fuse - this shedder script does exactly that. The shedder script provides several modes of operation of which the atonomous mode is the simplest-, most robust/reliable-, and with the quickest response time.

<img src="https://github.com/jonasbjurel/shellyShedder/blob/01c5b2ffe72093523176ae9bcac66f30427e2571/pictures/Atonomous.png" width="75%">

*Figure 1. Shelly shedding script in atonomus shedding configuration.*<br><br>
In atonomous mode the script controls the relays on the same shelly device it is running on. Apart from configuration and status updates there is no requirement on network connectivity (Ethernet/WiFi), the basic functions remain intact even if the connectivity fails. Further more, all current measurements and relay control happens locally with minimum latency resulting in prompt respone times for current measurement and relay control. Any Shelly device of generation 2 and higher, carying one or more relays with current measure capabilities can be used. Each of the shelly relay channels is configured with it's shedding priority, wether it is allowed to be shedded, wether it should be part of the fuse current measurement, etc. In the example given in *Figure 1* the scripts runs on a Shelly device with 4 relay channels.<br>
* The last channel (chanel 3) is connected to loads that has the lowest priority and will be disconnected/shedded first and hence configured with a priority of 2, in this example a car charger .<br>
* Channel 2, has the next lowest priority and is configured with a priority of 1, in this example it is connected to water heater.<br>
* Channel 1 has the highest priority among the channels that can be disconnected/shedded and have thus been configured with a priority of 0. In this example it is connected to heating system.<br>
* Channel 0 is in this example configured to never disconnect/shed and is in this example connected to loads which you would never want to disconnect: lights, out-lets, refridgerator, stove, ...<br>

As the group fuse rating gets over-subscribed the loads gets disconnected/shedded in priority order. If for instance the induction stove starts to draw massive amount of current the car charger may be disconnected/shedded, if at some time later the water heater needs to heat the water it may be disconnected/shedded, and if some one now connects a water-boiler to one of the outlets connected to Channel-0 the room heating is likely disconnected/shedded. As the loads decrease (water-boiler is un-plugged, dinner is ready, the warm water has heated) the loads are re-connected one after one in priority order as long ase the group-fuse is not over-subscribed.

### Protecting a single phase group fuse from tripping in distributed mode.
In case the atonomous mode shedding is not suitable because of the cabling topology, distances, etc. a distributed shedding mode can be applied.

<img src="https://github.com/jonasbjurel/shellyShedder/blob/01c5b2ffe72093523176ae9bcac66f30427e2571/pictures/Distributed.png" width="75%">

*Figure 2. Shelly shedding script in distributed shedding configuration.*<br><br>
In the distributed shedding mode setup, the shedding script running on one of the shelly devices part of the shedding group interacting with several remote shelly devices also participating in the shedding group to provide current readings, control of relays... <br>
Although in theory this setup provides the same functionality as for the atonomous mode - the characteristics is quite differen:
* It requires connectivity to work.
* Lost connectivity could lead to unexpected behaviour impacting robustness.
* The latency for measurement and control will be significantly higher than is the case for atonomous mode - leading to longer reaction times.

### Load balancing to avoid excessive grid load.
Another use case is to regulate the load drawn from the grid such that the current is capped below any potential grid provider threshold at which penalty fees apply. 
<img src="https://github.com/jonasbjurel/shellyShedder/blob/8278d0251a46eb7a93dd0ad9879470cea49bb8d1/pictures/GridLoadBalancing.png" width="75%">
In this scenario the grid current is reported through the utility meter's HAN port to some kind of automation entity. At currents close to the threshold, the automation entity can request capping of the current draw from one or several Shelly devices running the shedding script. The automation entity does not control the shedding priorities as that is thee task of each shedding script. 

## Description: 
This current shedding script maintains a load that prevents a single phase group fuse to trip-, 
and provides methods for northbound shedding systems to limit the current load.
Channels defined in "first_to_last_to_shed" are shedded one after one in
priority order. Shedding decisions are based on the group fuse_rating setting,
the group fuse characteristics setting (B,C,D,K,Z), the margin factor, and northbound 
requested current restrictions. 
Shedding decisions are not only based on over-current, but also on the fuse characteristics
for expected trip time or north-bound system set limitatations/restrictions. Shedding 
happens at the time for which the fuse would trip divided by the 
"margin_factor_setting", or instantaneously if the current exceeds north-bound
limitations set by "current_restriction_setting".

Re-loading/loading happens when the previously overloaded group fuse have been cooled 
down for "cool_down_time_setting" seconds, and the previous last good reading for
the disconnected channel in priority will fit within the total group fuse budget.
To avoid non recoverable situations where the previous last good reading is very
high or even exceeds the total group fuse budget due to exceptional events (shorts, 
connection of temporary high load devices, or otherwise), the script will try to 
reconnect a disconnected channel in priority order after "time_to_test_loading_setting "
seconds even if it would seemingly (based on last good reading) over-subscribe the
group fuse current budget.

The script provides a simulation mode where the operation can be simulated by setting
"simulation" to "true" and setting the "simulated_current" channel array to what ever
currents to simulate the behaviour. In simulation mode - the channels will not be switched,
but the expected switch behaviour can be observed as log entries in the console; Note that
log level needs to be set to "LOG_INFO" to observe the operations in simulation mode.

To observe the operations various logging-levels is defined by "LOG_LEVEL", available log 
levels are: "LOG_VERBOSE", "LOG_INFO", "LOG_WARN", "LOG_ERROR", "LOG_CRITICAL".
The logs are available through the local Shelly web-server or through the Shelly cloud service.

## Script configuration (persistant)
This script's behaviour depends on script configuration settings with default values as defined in the
script under "default settings...". The default script configurations are persistantly written to the
shelly KVS (Key Value Store) at the first startup of the script, or after a factory reset of the script/
or the device. The default settings can be changed through the provided Shelly KVS HTTP APIs,
or alternatively setting the KVS store from the shelly local- or cloud- web-page.<br>
CAUTION: The shelly KVS store is using a storage with limited number of writes (~100 K), limit the number
of programatically initiated re-configurations to ensure adequate life-time of the device.

Following script setting/HTTP APIs are supported (GET):

**Hostname:**<br>
*http://"ShellyURL"/rpc/KVS.Set?key="hostname_setting"&value=<hostname>*<br>
Sets the hostname of the Shelly device, hostname is needed for asynchronous status Webhook reporting.

**Group fuse rating:**<br>
*http://<"ShellyURL">/rpc/KVS.Set?key="fuse_rating_setting"&value=<fuse_rating [A]>*<br> 
Sets the group fuse rate rating.

**Group fuse characteristics:**<br> 
*http://<"ShellyURL">/rpc/KVS.Set?key="fuse_char_setting"&value=\<"B" | "C" | "D" | "K" | "Z"\>*<br>
Sets the group fuse characteristics.

**Shedding margin settings:**<br> 
*http://<"ShellyURL">/rpc/KVS.Set?key="margin_factor_setting"&value=<margin_factor>*<br>
Sets the margin factor from for which the theoretical group fuse trip time is divided by 
to determin the actual shedding time.

**Group fuse cool down time:**<br>
*http://<"ShellyURL">/rpc/KVS.Set?key="cool_down_time_setting"&value=<margin_fator>*<br>
Sets the group fuse cool down time in secoonds applied after the group fuse have been overloaded until it can be
re-loaded. This time is applied after shedding due to overload happened before it may re-load the fuse, but it is also
rellevant when the fuse was temporarilly re-loaded during a time-period shorter than the shedding time, if the fuse is again
overloaded before the "cool_down_time_setting" timer has expired a shedding event will immediately comence.

**Shedding group channel definition (first_to_last_to_shed):**<br>
*http://<"ShellyURL">/rpc/KVS.Set?key="first_to_last_to_shed"&value=<["ch0,ch1,ch2,ch3, ...]>*<br> 
Sets the array of channels to monitor and shed in reverse priority order (first element represents the channel with the least priority).
Each element is represented by a JSON object with key:value pairs:<br>
{addr: <URI|IPaddress|loacalhost>, gen:<shelly_generation>, type: <"relay"|switch|...>, id: <channel_id>, shed: <true|false>, measure: <true|false> <br>

* **addr**: Defines the IP address of the shelly device to participate in the shedding group. If set to "localhost" the local shelly device (same as the script runs on) is addressed and synchronous calls will be used to operate/shed the channels, otherwise HTTP RPCs will be used 
causing  latencies and may call for slightly longer "scan_interval" times (see below).

* **gen**: Defines the shelly device generation.

* **type**: Defines the shelly device type. "relay" indicates a relay that can paticipate in shedding actions, where "meter", "switch", etc.
potentially can participate in providing current measurement to be used by the shedding group.

* **id**: Defines the id/channel of the shelly device (Eg. 4PMPro has four 0-3).

* **shed**: Defines wether the channel is to be used for shedding or not <true | false>.

* **measure**: Defines weather the channel is to be used for group fuse current measurement <true | false>

Obviously, if both "shed" and "measure" is set to false, the channel is redundant and will in no way participate in the shedding group.

**Test loading time:**<br>
*http://<"ShellyURL">/rpc/KVS.Set?key="time_to_test_loading_setting"&value=\<time_to_test_loading\>*<br>
Sets Time_to_test_loading, if a shedded channel had a current value before it was shedded that seemingly does not fit the group fuse budget,
the channel will be reconnected after this time. This is to avoid situations where the last known current for some reason was so high that it will (almost) never again fit the group fuse value.

**Script scaning interval:**<br>
*http:<//"ShellyURL">/rpc/KVS.Set?key="scan_interval"&value=<scan_interval>*<br>
Sets the scripts scanning interval - meaning the response time for current changes, shedding events, timer-resolution, etc.
While a device that runs this script involving only autonomous operations (not involving other devices) could be set as low as 0.2 seconds,
a system involving other devices may require significantly higher intervals to acommodate for communication resource requirements, latencies,
and otherwise. 

**simulation (DEPRECATED):**<br>
*http://<"ShellyURL">/rpc/KVS.Set?key="simulated_current"&value=<true|false>*<br> 
......

**Set simulation current (DEPRECATED):**<br>
*http://<"ShellyURL">/rpc/KVS.Set?key="simulated_current"&value=<[Chan1_current, Chan2_current,
Chan3_current, Chan4_current, Chan5_current, ...]>*<br>
Simulated current settings per channel.

**Current restriction setting (DEPRECATED):**<br>
*http://<"ShellyURL">/rpc/KVS.Set?key="current_restriction_setting"&value=<maxCurrent>*<br>
A northbound current shedder may limit the allowed drawn current for this current shedder.
In contrast to group fuse overloading, current restriction leads to instant shedding when needed.

**Maximum current restriction(NEW):**<br>
*http://<"ShellyURL">/rpc/KVS.Set?key="max_current_restriction_setting"&value=<max_current_restriction>*<br>
The maximum current restriction a north bound shedder system can impose on the shedding group, eg. 
the minimum current it can ask the shedding group to adhere to.

**Current restriction hysteresis:**<br>
*http://<"ShellyURL">/rpc/KVS.Set?key="current_restriction_hysteresis_setting"&value=<restriction_current_loading_factor>*<br>
When current restriction from a north bound shedder have caused shedding, re-loading happens when the
expected current load after a channel reconnection is expected to be less than:
"(1-current_restriction_hysteresis_setting) * current_restriction_setting".

**Status webhook end-point(CHANGED):**<br>
*http://<"ShellyURL">/rpc/KVS.Set?key="status_webhook_uri_setting"&value=<"WebhookURI">*<br>
Sets the URI endpoint for the shedder status event Webhooks. 

**Log-level:**<br>
*http://<"ShellyURL">/rpc/KVS.Set?key="log_level_setting"&value=<"LOG_CRITICAL" | "LOG_ERROR" | "LOG_WARN" | "LOG_INFO" | "LOG_VERBOSE">*<br>
Sets log level.

**factory_reset_to_default(DEPRICATED):**<br>
*http://<"ShellyURL">/rpc/KVS.Set?key="factory_reset_to_default"*<br>

## Script interaction APIs (non persistant)
This shedder script provides non persistant run-time HTTP APIs that enables interaction with the shedder script and that retreives shedder information as well as asynchronous HTTP Webhook call-backs reporting important events to a pre-defined HTTP end-point. This set of APIs require that the Shelly script Id is part of the request URL. The script ID is stored in KVS and can be fetched through the "http://<"ShellyURL">/rpc/KVS.Get?key=<shedder_script_id>".

### Setting non persistant properties through HTTP APIs

**Factory reset(NEW):**<br>
*http://"ShellyURL"/script/<scriptId>/shedder?factory_reset_to_default*<br>
Resets and restarts the shedder script to factory default. Default settings as defined in the script will persistantly be applied to the KVS store and any custom configurations needs to be applied to the Shelly KVS store as described under
the "Script configuration (persistant)" section above. This method does not reset the shelly device as a whole to factory default, but only the shedder script it self.

Response body: None

**Restart(NEW)**<br>
*http://"ShellyURL"/script/<scriptId>/shedder?=restart*<br>
Restarts the shedding script, all persistant configurations are retained - but the the internal state machine is re-started, meaning that all shedding events-/states-, over-load-, cooling-, current-restriction-, etc. are reset.

Response body: None

**Current restriction (NEW):**<br>
*http://"ShellyURL"/script/<scriptId>/shedder?current_restriction=<current>"&validPeriod=<period>*<br>
A northbound current shedder system may limit the allowed drawn current for this current shedder group.
In contrast to group fuse overloading, current restriction leads to instant shedding when needed.
The "validPeriod" sets the time period in seconds for which the shedder group should adhere to the
current restriction, if the current north-bound curren shedder system has not contacted the shedder group with new instructions within this time the restriction is ceased.

Response body: A JSON object<br>
{currentRestriction:{result: <"OK"|"NOK">, maximumRestriction:<maximum_current_restriction>}

* **result** - Indicates if the restriction will be fullfilled in its entire or only partially.
* **maximumRestriction** - Indicates the curren lowest current load that a restriction could accomplish.


**Simulation**<br>
*http://"ShellyURL"/script/<scriptId>/shedder?simulation=<true|false>*<br>
Sets or un-sets the shedder script simulation mode. When simulation mode is set, the currents are not measured from the physical channels, but are set by the "simulated_current" API as described below. 
In simulation mode the physical relays are not operated but the intended relay operations can be
observed by log-entries in the Shelly console, or by scanning the the switch state, or by
monitoring the status web-hook event.

Response body a JSON object<br>
{simulation:true|false}

**Set simulated current**<br>
*http://"ShellyURL"/script/<scriptId>/shedder?setSimulatedCurrent=<Ch0_current, Ch1_current,
Ch2_current, Ch3_current, ...[A]]>*<br>
Sets the simulated current for each of the shedder channels.

Response body: A JSON object<br>
{simulatedCurrent:[ch0_curr, ch1_curr, ch2_curr, ch3_curr,...]}

### Requesting status through HTTP APIs
**Get current status**<br>
*http://"ShellyURL"/script/<scriptId>/shedder?getCurrent*<br>
Retrievs the total measured current and current for each channel.

Response body: A JSON object:<br>
{current:{total: <total_current>, channels:[ch1_curr,ch2_curr,ch3_curr,....]}}

**Get load status**<br>
*http://"ShellyURL"/script/<scriptId>/shedder?getLoadStatus*<br>
Retrievs the load status for the shedder.

Response body: A JSON object:<br>
{loadStatus:{loadDirection:<"shedding"|"loading"|"coasting", 
overLoadTimeRemaining:<over_load_time_remaining>,
coolDownTimeRemaining:<cool_down_time_remaining>,
testLoadTimeRemaining:<test_load_time_remaining>,
nextToShed:<next_channel_to-shed>,
lastKnownCurrent:[ch0_curr, ch1_curr, ch2_curr, ch3_curr, ....]
currentRestriction:<current_restriction_setting>}}

* **loadDirection:** shedding - "shedding" of channel(s) is ongoing, "loading" - re-loading of channel(s)
  is ongoing, "coarsing" - no shedding/loading is ongoing.
* **overLoadTimeRemaining** - Time remaining before a shedding will happen (-1 means that there is no overload at hand).
* **coolDownTimeRemaining** - Time before any potential re-loading may happen (-1 means that there is no fuse cooling ongoing).
* **testLoadTimeRemaining** - Time before a test loading will happen despite if it seems not to fit the
group fuse budget.
* **nextToShed** - Next channel to shed if overload so requires.
*  **lastKnownCurrent** - A vector with all channels last known read current, the current could be the
result from a recent reading, but could also be from a reading prior to a channel was shedded.

**Get fuse trip time**<br>
*http://"ShellyURL"/script/<scriptId>/shedder?getTripTime=<current[A]>*<br>
Requests the calculated group fuse trip time for the specified current and the configured group fuse.
This request does not really request any shedder operational data, but instead invokes the trip-time
calculation routine to give an estimated trip-time.

Response body: A JSON object:<br>
{tripData:{current:trip_current, tripTime:<trip_time>,
shedMarginFactor:<margin_factor_setting>}}

**Get switch status**<br>
*http://"ShellyURL"/script/<scriptId>/shedder?getSwitchStatus*<br>
Response body: A JSON object:<br>
{switchStatus:[
{addr: <URI|IPaddress|loacalhost>, gen:<shelly_generation>2, type: <"relay"|switch|...>, id: <channel_id>, shed: <true|false>, measure: <true|false>, switch_state: <"on"|"off", priority: <prio>}, ...]}

Each vector element represents a channel in the shedding group, the kv structure is almost identical to that in the "first_to_last_to_shed" script configuration. Two key/value pairs have been added:

* **switch_state** - Indicating if the switch/relay is "on" or "off"
* **priority** - Providing the shedding priority of the shedder channel, in practice the priority
follows the element's order in the vector (0:highest priority - N:lowest priority) 

### Asynchronous status Webhook events (NEW).
When the shedder group status changes (shedding/loading) a status webhook can be sent to a HTTP
end-point providing the end-point is defined in the shedder script "status_webhook_uri_setting" configuration.
The web-hook is sent whenever the status is changed, as well as periodically at every minute. 

The webhook is sent to the configured target end-point as a HTTP PUT request:<br>
*http://<targetEndpointURI>/shedder/<hostname>/status*<br>

Request body: A JSON object:<br>
*{shedderStatus:{hostName: <hostname_setting>, loadDirection: <"shedding"|"loading"|"coasting">
<shedding: <true|false>, nextToShed:<next_channel_to-shed>, fuseProtectionShedding<true|false>, restrictionProtectionShedding:<true|false>, groupFuseCurrent: <current>, groupFuseCurrent: <current>,
channel_current:[ch1_curr,ch2_curr,ch3_curr,ch4_curr,...[A]]}}*<br>

## Key considerations:
1. Make sure the value set for "fuse_rating_setting" and "fuse_char_setting" 
corresponds to-/or is lesser than the group fuse setting for the shedding group.
2. Set the "margin_factor_setting" to a value grater than 1. If set at 1 the shedding will
happen at the exact moment (or even after) of the expected tripping of the fuse according to IEC 60269.
The shedding time is calculated by the tripping time divided by the "margin_factor_setting",
hence if set to 2 the shedding will happen at half the time from when the fuse tripping 
would happen (provided that the fuse was @ 30 degrees when the overload
happened".<br>
**A good value is likely between 2-4.**
3. "cool_down_time_setting" defines a fuse quarantine time after overloading for during
which the group fuse needs time to cool down, and no increased loading is allowed.<br>
**120 to 600 seconds setting is a recommended value.**
4. "time_to_test_loading_setting" defines the time until the disconnected channels in priority
order is re-connected despite that it seemingly does not fit the group fuse budget.
This is needed when a channel momentarily gets overloaded to a level close to- or above the
fuse rating causing the normal loading mechanism to never reconnect the channel.<br>
**Suggested setting is between 900- and 1800 seconds.**
5. "scan_interval" defines the interval inbetween subsequent measurements/actions.<br>
**Recommended value is between 0.2 and 1 seconds.**
6. You may have as few as one shedding group channel, but there is no technical upper limit on number of channels. The channels (switches) may be located on the device that this script runs on 
(localhost - autonomous operation), or may be distributed to several devices communicating over
a layer-3 IP network. Please note that the higher numbered entries (4 and 5 here) would be
considered the highest priority - last turned off, and first turned on.
If a measure/shed/load operation relates to a channel local to the shedding script (localhost) it
will be handled synchronously with a neglectable latancy, otherwise asynchronous RPC calls with delays will be used creating latancies reducing the real-time performance and reponse times, in such case the
"scan_interval" may need to be increased to avoid over-runs and unnecessarily worse performance.
7. Current restriction ("current_restricion_setting") is a way for north-bound shedding
systems to ask for a current limitation of this device due to northbound current
contentions. Whenever the current measured through this shedding device is above the
"current_restricion_setting" it will instantly try to shed the current according
to normal priority principles. To avoid oscilations a 
"current_restriction_hysteresis_setting" hysteresis factor is applied before the
re-loading of channels may happen. **A value of 0.1 to 0.2 is recommended**

## Contious integration
The shedder script comes with an extensive automated verification script - "shedder.js" that aims to verify all the aspects of the shedder script in simulated mode. The real current measurement and
relay operations are currently not verified, but needs to be verified manually.

## Contious deployment
There is currently no automated script deployment, at current only agestone copy- and paste mechanisms from github to the actual shelly device exists. The plan is to be able to provide mechanisms to pull  script repos/branches/releases from github to the shelly device in a seamless way.
