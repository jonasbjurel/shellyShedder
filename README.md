# Shelly load shedder

A general shelly load shedding script

(C) Jonas Bjurel et Al.

License: Apache 2 

## Description: 
This script maintains a load that prevents a single phase group fuse to trip and provides
methods for northbound shedding systems to limit the current load.
Channels defined in "first_to_last_to_shed" are shedded one after one in
priority order. Shedding decisions are based on the "fuse_rating_setting",
"fuse_char_setting", "margin_factor_setting" and "current_restriction_setting". 
Shedding decisions are not only based on over-current, but on the fuse characteristics
for expected trip time or north-bound system set limitations, shedding 
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

## Script configuration (persistant)
This script's behaviour depends on script settings with default settings as defined in this
script under "default settings...". The default script configurations are written to the
shelly KVS (Key Value Store) which is persistant at the first run of the script, or after
a factory reset of the script or the device. The default settings can be changed by changing the 
default settings in the script (not recommended) following a script factory reset or
(the recommended way) to persistently set script configuration through the provided KVS HTTP
webhooks.
Following script setting/Webhooks are supported (GET):

**hostname_setting:**<br>
*http://"ShellyURL"/rpc/KVS.Set?key="hostname_setting"&value=\<hostname\>*<br>
Sets the hostname of the Shelly device, hostname is needed for overload Webhook reporting.

**fuse_rating_setting:**<br>
*http://"ShellyURL"/rpc/KVS.Set?key="fuse_rating_setting"&value=\<fuse rating in Amps\>*<br> 
Sets the group fuse rate rating.

**fuse_char_setting:**<br> 
*http://"ShellyURL"/rpc/KVS.Set?key="fuse_char_setting"&value=\<"B" | "C" | "D" | "K" | "Z"\>*<br>
Sets the group fuse characteristics.

**margin_factor_setting:**<br> 
*http://"ShellyURL"/rpc/KVS.Set?key="margin_factor_setting"&value=\<margin_factor\>*<br>
Sets the margin factor from for which the theoretical group fuse trip time is devided by to determin the shedding time.

**cool_down_time_setting:**<br>
*http://"ShellyURL"/rpc/KVS.Set?key="cool_down_time_setting"&value=\<margin_factor\>*
Sets the group fuse cool down time in secoonds applied after fuse have been overloaded until it can be
reloaded. This time is applied after a shedding due to overload happened before it may reload the fuse. But it is also
rellevant when the fuse was temporarilly reloaded during a time-period shorter than the shedding time, if the fuse is again
overloaded before the "cool_down_time_setting" timer has expired a shedding event will immediately comence.

**first_to_last_to_shed:**<br>
*http://"ShellyURL"/rpc/KVS.Set?key="first_to_last_to_shed"&value=\<["Ch1,Ch2,Ch3,Ch4,Ch5, ...]\>*<br> 
Sets the array of channels to monitor and shed in reverse priority order (first element represents the channel with the least priority).
Eache element is represented by a JSON object with key:value pairs:<br>
{ addr: "localhost", gen: 2, type: "relay", id: 3, shed: true, measure: true } <br>

  * **addr**: Represents the IP address of the shelly device to participate in the shedding group. If set to "localhost" the local shelly device
(same as the script runs on) is addressed and synchronous calls will be used to operate/shed the channels, otherwise HTTP RPCs will be used 
causing a latency whch may call for slightly longer "scan_interval" times (see below).

  * **gen**: Defines the shelly device generation.

  * **type**: Defines the shelly device type. "relay" indicates a relay that can paticipate in shedding actions, where "meter", "switch", etc.
potentially can participate in providing current measurement to be used by the shedding group.

  * **id**: Provides the id/channel of the shelly device (Eg. 4PMPro has four 0-3).

  * **shed**: Indicates wether the channel is to be used for shedding or not <true | false>.

  * **measure**: Indicates weather the channel is to be used for group fuse current measurement <true | false>

Obviously, if both "shed" and "measure" is set to false, the channel is redundant and will in no way participate in the shedding group.


**time_to_test_loading_setting:**<br>
*http://"ShellyURL"/rpc/KVS.Set?key="time_to_test_loading_setting"&value=\<time_to_test_loading\>*<br>
Sets Time_to_test_loading, if a shedded channel had a current value before it was shedded that seemingly does not fit the group fuse budget,
the channel will be reconnected after this time. This is to avoid situations where the las known current for some reason was so high that
it will almost never again fit the group fuse value.

**scan_interval:**<br>
*http://"ShellyURL"/rpc/KVS.Set?key="scan_interval"&value=\<scan_interval\>*<br>
Sets the scripts scanning interval - meaning the response time for current changes, shedding events, timer-resolution, etc.
While a device that runs this script involving only autonomous operations (not involving other devices) could be set as low as 0.2 seconds,
a system involving other devices may require significantly higher intervals to acommodate for communication resource requirements, latencies,
and otherwise. 

**simulation:**<br> //SHould this really be part of KVS
*http://"ShellyURL"/rpc/KVS.Set?key="simulated_current"&value=\<true|false\>*<br> 
Simulation mode. When simulation mode is set, the currents are not measured from the physical
channels, but are set by the "simulated_current" webhook as described below. In simulation mode
physical relays are not operated but the intended relay operations can be observed by log-entries
in the Shelly console.

**simulated_current:**<br> //Should not be part of KVS
*http://"ShellyURL"/rpc/KVS.Set?key="simulated_current"&value=\<\[Chan1_current, Chan2_current,
Chan3_current, Chan4_current, Chan5_current, ...\]\>*<br>
Simulated current settings per channel.

**current_restriction_setting:**<br> //Should not be part of KVS
*http://"ShellyURL"/rpc/KVS.Set?key="current_restriction_setting"&value=\<maxCurrent\>*<br>
A northbound current shedder may limit the allowed drawn current for this current shedder.
In contrast to group fuse overloading, current restriction leads to instant shedding when needed.

**current_restriction_hysteresis_setting:**<br>
*http://"ShellyURL"/rpc/KVS.Set?key="current_restriction_hysteresis_setting"&value=<restriction_current_loading_factor>*<br>
When current restriction from a north bound shedder have caused shedding, re-loading happens when the expected current
load after a channel reconnection is expected to be less than 
"(1-current_restriction_hysteresis_setting) * current_restriction_setting".

**overload_webhook_uri_setting:**<br>
*http://"ShellyURL"/rpc/KVS.Set?key="let overload_webhook_uri_setting"&value=\<"WebhookURI"\>*<br>
Sets the URI endpoint for overload event Webhooks. 

The webhook JSON data provided are:<br> 
*{hostname: hostname_setting, state: "shedding|loading|coasting", current: "current [A]", next_to_discconect: "current channel"}*<br>

**log_level_setting:**<br>
*http://"ShellyURL"/rpc/KVS.Set?key="log_level_setting"&value=<"LOG_CRITICAL" | "LOG_ERROR" | "LOG_WARN" | "LOG_INFO" | "LOG_VERBOSE">*<br>
Sets log level - logging happens to the Shelly console.

**factory_reset_to_default:**<br> //Shall not be a KVS entry
*http://"ShellyURL"/rpc/KVS.Set?key="factory_reset_to_default"*<br>
Resets and reboots the shedder script device to factory default (default settings as defined in the script).

## Script interaction APIs (non persistant)
This shedder script provides HTTP APIs that sets shedder script properties, and that retreives shedder information as well as HTTP call-backs
which asynchronously reports important events to a pre-defined HTTP end-point.

### Setting non persistant properties through HTTP APIs

### Requesting status through HTTP APIs

### Retreiving events to a predefined HTTP end-point

## Key considerations:

1. Make sure the value set for "fuse_rating_setting" and "fuse_char_setting" 
corresponds to-/or is lesser than the group fuse setting for the shedding group.
2. Set the "margin_factor_setting" to a value grater than 1. If set at 1 the shedding will
happen at the exact moment of the expected tripping of the fuse according to IEC 60269.
The shedding time is calculated by the tripping time divided by the "margin_factor_setting",
hence if set to 2 the shedding will happen at half the time from when the fuse tripping 
would happen (provided that the fuse was @ 30 degrees when the overload
happened".<br>
**A good value is likely between 2-4.**
3. "cool_down_time_setting" defines a fuse quarantine time after overloading for during
which the group fuse needs time to cool down, and no increased loading is allowed.<br>
**120 to 600 seconds setting is recommended.**
4. "time_to_test_loading_setting" defines the time until the disconnected channels in priority
order are re-connected despite that they seemingly does not fit the fuse budget.
This is needed when a channel momentarily gets overloaded to a level close to- or above the
fuse rating causing the normal loading mechanism to never reconnect the channel.<br>
**Suggested setting is between 900- and 1800 seconds.**
5. "scan_interval" defines the interval inbetween subsequent measurements/actions.<br>
**Recommended value is between 0.05 and 0.3 seconds.**
6. You may have as few as one channel, and there is no technical upper limit on number of channels.
The channels (switches) may be located on the device that this script runs on 
(localhost - autonomous operation), or may be distributed to several devices communicating over
a layer-3 IP network. Please note that the higher numbered entries (4 and 5 here) would be
considered the highest priority - last turned off, and first turned on.
If a channel operations happens synchronously with a neglectable
delay, otherwise asynchronous calls with delays nee is on addr: "localhost", the channeld to be applied to turn a channel on/off.
The "shed" keyword defines weather the channel can be shedded or not, and the "measure" keyword
defines if the channel shall be accounted for the total current part of the group fuse budget,
or the north bound current restriction budget.<br>
**Example:**<br>
``` 
[{ addr: "192.168.1.100", gen: 2, type: "Switch", id: 100 ,shed: false, measure: true },       // Shelly Pro 3EM
{ addr: "192.168.52.4", gen: 1, type: "relay", id: 0 }, shed: false, measure: true },          // A first generation Shelly relay
{                                                                                              // A generic device webhook
  shed: false,
  measure: true
  on_url: "http://192.168.1.101/rpc/switch.Set?id=0&on=true",                                  // A generic channel turn-on Webhook
  off_url: "http://192.168.1.101/rpc/switch.Set?id=0&on=false",                                // A generic channel turn-off Webhook
  measure_current_url: "http://192.168.1.101/rpc/switch.GetCurr?id=0"                          // A generic channel current measure Webhook
},
{ addr: "192.168.52.3", gen: 2, type: "relay", id: 0,	shed: false, measure: true },          // A Shelly Plus or Pro relay (first channel)
{ addr: "192.168.52.2", gen: 2, type: "relay", id: 1, shed: false, measure: true },            // A Shelly Plus or Pro relay (second channel)
];
``` 
7. Current restriction ("current_restricion_setting") is a way for north-bound shedding
systems to ask for a current limitation of this device due to northbound current
contentions. Whenever the current measured through this shedding device is above the
"current_restricion_setting" it will instantly try to shed the current according
to normal priority principles. To avoid oscilations a 
"current_restriction_hysteresis_setting" hysteresis factor is applied before the
re-loading of channels may happen. **A value of 0.1 to 0.2 is recommended**
