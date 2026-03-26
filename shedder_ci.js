/*********************************************************************************************************
 * @title: Test suite for the eneral shelly load shedding script
 * @(C): Jonas Bjurel et Al.
 * @License: Apache 2 
 * @description:
 * This is an automated test suite for the Shelly shedder script found here: 
 * https://github.com/jonasbjurel/shellyShedder/blob/main/shedder.js
 * A detailed description can be found here: https://github.com/jonasbjurel/shellyShedder/blob/main/README.md
 *********************************************************************************************************/

let fuse_rating_setting = 16;
let fuse_char_setting = "C";
let margin_factor_setting = 4;
let cool_down_time_setting = 10;
let time_to_test_loading_setting = 120;
let current_restriction_hysteresis_setting = 0.1;
let target_scan_interval = 0.5;
let shelly_call_records = [];
let calls = 0;
let timer = [0,0,0,0,0];
let kvs_set_cnt = 0;
let target_script_id = undefined;
let KVSBackup = undefined;
let verification_phase = 0;
let verification_sub_phase = 0;
let verification_sub_sub_phase = 0;
let verification_current_vector = new Array(8);
let verification_trip_data = 0;
let wait_for_shed = 0;
let wait_for_cool = 0;
let calls = 0;
let shelly_call_records = [];
let scan_interval = 0.5;
let current = undefined;
let switch_status = undefined;
let load_status = undefined;
let lowest_prio_chan = 0;

/********************************************    Constants ***********************************************/
const LOG_PREFIX = "shedderCI";
const LOG_VERBOSE = 0;
const LOG_INFO = 1;
const LOG_WARN = 2;
const LOG_ERROR = 3;
const LOG_CRITICAL = 4;
const CALL_LIMIT = 5;
/*********************************************************************************************************/

log_level_setting = LOG_INFO;

/*********************************************************************************************************/
/*                                          Platform functions                                           */
/*********************************************************************************************************/

/* function def(o);
 * Check if defined */

function def(o) {
  return typeof o !== "undefined";
}


/* function log(severity, log_entry);
 * Log entries to console according to "log_level_setting" which can be any of
 *  LOG_VERBOSE, LOG_INFO, LOG_WARN, LOG_ERROR and LOG_CRITICAL */
 
function log(severity, log_entry) {
  if (severity >= log_level_setting)
    print(LOG_PREFIX + ": " + log_entry);
}

/* function queueShellyCall()
 * Queues a shelly call. As Shelly only allows a very limited number of system calls running in parallel,
 * this functions helps to serialize Shelly calls by queueing them for execution, one after one. */
function queueShellyCall(method, method_param, cb_fun, cb_fun_params) {
  shelly_call_records.push({meth:method, meth_param: method_param, cb: cb_fun,
   cb_params: cb_fun_params});
  if (shelly_call_records.length == 1) {
    Shelly.emitEvent("continueExecQueuedShellyCalls", {});
  }
}


/* function execQueuedShellyCalls()
 * Executes queued shelly calls, when a call has finished it's synchronous execution,
 * the next in the queue's execution gets triggered by the "continueExecQueuedShellyCalls"
 * event */
 
function execQueuedShellyCalls(event) {
  if (shelly_call_records.length && calls < CALL_LIMIT) {
    calls ++;
    Shelly.call(shelly_call_records[0].meth, shelly_call_records[0].meth_param,
                function(result, error_code, error_message, call_record) {
		              call_record.cb(result, error_code, error_message,
                                     call_record.cb_params);
                      calls--;
		              if (shelly_call_records.length && calls == CALL_LIMIT-2){
		                Shelly.emitEvent("continueExecQueuedShellyCalls", {});
		                log(LOG_VERBOSE, "Resuming calls");
		              }
                }, shelly_call_records[0]
    );
    shelly_call_records.splice(0, 1);
    if (shelly_call_records.length)
      Shelly.emitEvent("continueExecQueuedShellyCalls", {}); 
  }
  else {
    log(LOG_VERBOSE, "Max calls reached, pausing calls");
  }
}


/* function shellyCallQueueEmpty()
 * returns true if the call queue is empty, otherwise false */ 
function shellyCallQueueEmpty() {
   if (shelly_call_records.length)
     return false;
   else 
     return true;
}

/* function shellyEventCb()
 * A shelly or user defined event has been triggered */
function shellyEventCb(event) {
  switch (event.name){
    case "script":
      switch (event.info.event) {
        case "continueExecQueuedShellyCalls":													// A Shelly call task is completed, continue
          execQueuedShellyCalls(event);															// with next.
          break;
        default:
          break;
      }
      break;
    default:
      break;
  }
}


function waitTimer(timer_id, time) {
  if (timer[timer_id] == 0) {
    timer[timer_id] = ~~(time/scan_interval);
    //print("Timer: " + timer[timer_id]);
    return false;
    }
  else {
    timer[timer_id]--;
    //print(timer[timer_id]);
    return true;
  }
}


/* function reboot()
 * Reboots the Shelly */
 /*
function reboot() {
  Shelly.Reboot();
}
*/


function backupKVS(cb) {
  queueShellyCall("KVS.GetMany", {match:"*"}, 
                  function (result, error_code, error_message, cb) {
                    cb(result, error_code, error_message);
                  },
				  cb
                  );
}


function KVSSet(key_values, cb) {
  if(kvs_set_cnt != 0)
    return -1;
  //print("KVS1 " + JSON.stringify(key_values));
  queueShellyCall("KVS.GetMany", {match:"*"},
                  function(result, error_code, error_message, params) {
                    for(key in params.key_values) {
                      for(let i=0; i<result.items.length; i++) {
                        if (key === result.items[i].key && result.items[i].value != params.key_values[key]) {
                          print("setting key " + key + " to value: " + params.key_values[key]);
                          kvs_set_cnt++;
                          queueShellyCall("KVS.Set", {key:key, value:params.key_values[key]},
                                          function(result, error_code, error_message, cb) {
                                            //print("result: " + result + " Error message: " + error_message);
                                            kvs_set_cnt--;
                                            if(!kvs_set_cnt && def(cb))
                                              cb();
                                            return;
                                          },
                                          params.cb
                                          );
                        break;
                        }
                      }
                    }  
                    return;
                  },
                  {cb:cb, key_values:key_values}
                  );
  return 0;
}


function setCurrentRestriction(current_restriction, cb) {
  queueShellyCall("HTTP.GET", {url:"http://localhost/script/" + target_script_id +
                              "/shedder?setCurrentRestriction=" + current_restriction}, 
                  function (result, error_code, error_message, cb) {
                    if(def(cb))
                      cb(result, error_code, error_message);
                  },
                  cb
                  );
}


function factoryReset(cb) {
  queueShellyCall("HTTP.GET", {url:"http://localhost/script/" + target_script_id +
                              "/shedder?factory_reset_to_default"}, 
                  function (result, error_code, error_message, cb) {
                    if(def(cb))
                      cb(result, error_code, error_message);
                  },
                  cb
                  );  
}


function setSimulation(simulation, cb) {
  queueShellyCall("HTTP.GET", {url:"http://localhost/script/" + target_script_id +
                              "/shedder?simulation=" + simulation}, 
                  function (result, error_code, error_message, cb) {
                    if(def(cb))
                      cb(result, error_code, error_message);
                  },
                  cb
                  );  
}


function setSimulatedCurrent(current, cb) {
  //print("http://localhost/script/" + target_script_id +
  //      "/shedder?setSimulatedCurrent=" + JSON.stringify(current));
  queueShellyCall("HTTP.GET", {url:"http://localhost/script/" + target_script_id +
                              "/shedder?setSimulatedCurrent=" + JSON.stringify(current)}, 
                  function (result, error_code, error_message, cb) {
                    if(def(cb))
                      cb(result, error_code, error_message);
                  },
                  cb
                  );
  
}


function getCurrent(cb) {
  queueShellyCall("HTTP.GET", {url:"http://localhost/script/" + target_script_id +
                                   "/shedder?getCurrent"}, 
                  function (result, error_code, error_message, cb) {
                    //print(atob(result.body_b64));
                    result = JSON.parse(atob(result.body_b64));
                    if(def(result) && "current" in result) 
                        cb(result.current, error_code, error_message);
                    else
                      cb(result, error_code, error_message);
                    return;
                  },
                  cb
                  );
}

function getTripTime(current, cb) {
  queueShellyCall("HTTP.GET", {url:"http://localhost/script/" + target_script_id +
                                   "/shedder?getTripTime=" + current}, 
                  function (result, error_code, error_message, cb) {
                    result = JSON.parse(atob(result.body_b64));
                    if(def(result) && "tripData" in result) 
                        cb(result.tripData, error_code, error_message);
                    else
                      cb(result, error_code, error_message);
                    return;
                  },
                  cb
                  );
}


function getSwitchStatus(cb) {
  queueShellyCall("HTTP.GET", {url:"http://localhost/script/" + target_script_id +
                                   "/shedder?getSwitchStatus"}, 
                  function (result, error_code, error_message, cb) {
                    result = JSON.parse(atob(result.body_b64));
                    if(def(result) && "switchStatus" in result)
                      cb(result.switchStatus, error_code, error_message);
                    else
                      cb(result, error_code, error_message);
                    return;
                  },
                  cb
                  );
}

function getLoadStatus(cb) {
  queueShellyCall("HTTP.GET", {url:"http://localhost/script/" + target_script_id +
                              "/shedder?getLoadStatus"}, 
                  function (result, error_code, error_message, cb) {
                    //print(atob(result.body_b64));
                    result = JSON.parse(atob(result.body_b64));
                    if(def(result) && "loadStatus" in result)
                      cb(result.loadStatus, error_code, error_message);
					else
                      cb(result, error_code, error_message);
                    return;
                  },
				  cb
                  );
}

function includes(array, value){
  for (let i=0; i<array.length; i++) {
    if(array[i] === value)
      return true;
  }
  return false;
}

function getPrioChannel(switch_status, prio){
  let step = prio < 0 ? -1:1;
  let start = prio < 0 ? switch_status.length-1 : 0;
  let stop = prio < 0 ? 0 : switch_status.length;
  let prio_index = -1;
  for (let i=start; i == stop; i+= step) {
    if(switch_status[i].shed) {
      //print("Found switch priority " + prio + " at index " + i);
      return i;
    }
  }
  //print("Could not find switch priority " + prio);
  return -1;
}

function noShed(switch_status, perfect_match, channels) {
  if (!def(channels)) {
    channels = new Array(switch_status.length);
    for (let i=0; i<switch_status.length; i++)
      channels[i] = i;
    perfect_match = true;
  }
  for (let i=0; i<switch_status.length; i++) {
    if(includes(channels, switch_status[i].id) && switch_status[i].switch_state === "on")
      continue;
    if(includes(channels, switch_status[i].id) && switch_status[i].switch_state === "off")
      return false;
    else if (perfect_match && switch_status[i].shed && switch_status[i].switch_state === "on")
      return false;
  }
  return true;  
}

function shed(switch_status, perfect_match, channels) {
  if (!def(channels))
    return switch_status.some(function(sw){return (sw.switchState == "on" && sw.shed) ? false:true});
  else {
    for (let i=0; i<switch_status.length; i++) {
      if(includes(channels, switch_status[i].id) && switch_status[i].switch_state === "off")
        continue;
      else if(includes(channels, switch_status[i].id) && switch_status[i].switch_state === "on")
        return false;
      else if (perfect_match && switch_status[i].shed && switch_status[i].switch_state === "off")
        return false;
    }
    return true;  
  }
}
/*********************************************************************************************************/

function stopScript() {
  queueShellyCall("Script.Stop", {id: Shelly.getCurrentScriptId()});
}
/*********************************************************************************************************/
/*                                         CI/CD verification                                            */
/*********************************************************************************************************/

function verificationEngine() {
  switch (verification_phase) {
    case 0:
      //verification_phase++
      //break;
      if (waitTimer(0,1)) return;
      switch (verification_sub_phase) {
        case 0:
          if(verification_sub_sub_phase == 0) {
            log(LOG_INFO, "============= Setting up Shedder CI =============");
            queueShellyCall("Script.List", null, function (result, error_code, error_message) {
                                         for(let i=0; i<result.scripts.length; i++) {
                                           if(result.scripts[i].name == "shedder") {
                                             target_script_id = result.scripts[i].id;
                                             break;
                                           }
                                         }
                                       }
                                       );
          }
          if (!def(target_script_id) && verification_sub_sub_phase < 10) {
            verification_sub_sub_phase++;
            return;
          } 
          else if (!def(target_script_id) && verification_sub_sub_phase >= 10) {
            log(LOG_ERROR, "Setup ERROR: Shedder script could not be identified");
            verification_phase = -1;
            stopScript();
            return;
          }
          else {
            log(LOG_INFO, "Setup INFO: Target script identified, Id: " + target_script_id);
            verification_sub_phase++;
            verification_sub_sub_phase = 0;
            return;
          }
          
        case 1:
          if(verification_sub_sub_phase == 0) {
            log(LOG_INFO, "Setup INFO: Backing up KVS");
            backupKVS(function(result, error_code, error_message){if(def(result)) KVSBackup = result});
            verification_sub_sub_phase++;
            return;
          }
          if(!("items" in KVSBackup) && verification_sub_sub_phase < 10) {
            verification_sub_sub_phase++;
            //print("No backup yet: " + JSON.stringify(KVSBackup));
            return;
          }
          else if (!("items" in KVSBackup) && verification_sub_sub_phase >= 10) {
            log(LOG_ERROR, "Setup ERROR: Could not create KVS-backup");
            verification_phase = -1;
            stopScript();
            return;
          }
          else {
            log(LOG_INFO, "Setup INFO: KVS backup created");
            verification_sub_phase++;
            verification_sub_sub_phase = 0;
            return;
          }
          
        case 2:
          log(LOG_INFO, "Setup INFO: Setting up KVS, simulation, etc..");
          KVSSet({fuse_rating_setting:fuse_rating_setting, fuse_char_setting:fuse_char_setting,
                  margin_factor_setting:margin_factor_setting, cool_down_time_setting:cool_down_time_setting,
                  time_to_test_loading_setting:time_to_test_loading_setting, current_restriction_hysteresis_setting:current_restriction_hysteresis_setting,
                  scan_interval:target_scan_interval, log_level_setting:LOG_INFO});
          setCurrentRestriction(-1);
          setSimulation(true);
          setSimulatedCurrent([0,0,0,0]);
          break;
          
        default:
          return;
      }
      log(LOG_INFO, "Setup SUCCESS: Shedder CI successfully set-up");
      current = undefined;
      load_status = undefined;
      switch_status = undefined;
      verification_phase++; 
      verification_sub_phase = 0;
      verification_sub_sub_phase = 0;
      break;

//TC-1: Stabelizion Shedder
    case 1:
      if (waitTimer(0,5)) return;
      if(verification_sub_phase == 0) {
        log(LOG_INFO, "============= Waiting for shedder to stabelize =============");
      }
      getCurrent(function(result, error_code, error_message) {current = result});
      getSwitchStatus(function(result, error_code, error_message) {switch_status = result});
      getLoadStatus(function(result, error_code, error_message) {load_status = result});
      //print("current: " + JSON.stringify(current));
      //print("Load: " + JSON.stringify(load_status));
      //print("Switch: " + JSON.stringify(switch_status));
      if (def(current) && def(switch_status) && def(load_status) && current.total == 0 &&
        !switch_status.some(function(sw) {return sw.switchState == "off";}) && //Switchstate seems not to work
        load_status.overLoadTime == -1 && load_status.coolDownTimeRemaining == -1) {
        log(LOG_INFO, "Stabelizing SUCCESS: Shedder has stabelized");
        current = undefined;
        load_status = undefined;
        switch_status = undefined;
        verification_phase++; 
        verification_sub_phase = 0;
        break;
      }
      if(verification_sub_phase >= 24) {
        log(LOG_ERROR, "Stabelizing ERROR: Shedder has not stabelized in 2 minutes");
        stopScript(true);
        verification_phase = -1;
        break;
      }
      verification_sub_phase++;
      break;
      
//TC-2: Current measurement

    case 2:
      if (waitTimer(0,4)) return;
      if (verification_sub_phase == 0) {
        log(LOG_INFO, "============= Running Current measurement test =============");
        verification_current_vector = [0,0,0,0,1,1,1,1];
        log(LOG_INFO, "Current mesurement INFO: Changing simulated current to " + verification_current_vector.slice(0,4));
        setSimulatedCurrent(verification_current_vector.slice(0,4));
      }
      else {
        if (verification_sub_phase >= 0 && verification_sub_phase % 3 == 0) { //0,3,6,9, ...
          verification_current_vector.push(verification_current_vector.splice(0,1)[0]); //rotate the current vactor left
          log(LOG_INFO, "Current mesurement INFO: Changing simulated current to " + verification_current_vector.slice(0,4));
          setSimulatedCurrent(verification_current_vector.slice(0,4));
        }
        if((verification_sub_phase-1) >= 0 && (verification_sub_phase-1) % 3 == 0) { // 1,4,7,10, ...
          log(LOG_INFO, "Current mesurement INFO: Reading current through RPC");
          getCurrent(function(result, error_code, error_message) {current = result});
        }
        if((verification_sub_phase-2) >= 0 && (verification_sub_phase-2) % 3 == 0) { //2,5,8,11, ...
          if(!def(current)) {
            log(LOG_ERROR, "Current mesurement ERROR: Current reading failed, did not get any measure");
            stopScript(true);
            verification_phase = -1;
            break;
          }
          let total_expected_channels_current = 0;
          for(let i=0; i<verification_current_vector.slice(0,4).length; i++) {
            if(current.channels[i] != verification_current_vector.slice(0,4)[i]) {
              log(LOG_ERROR, "Current mesurement ERROR: read channel " + i +
              " current is not as expected. " + "reading != expected: " +
              current.channels[i] + " != " + verification_current_vector.slice(0,4)[i]);
              stopScript(true);
              verification_phase = -1;
              break;             
            }
            log(LOG_INFO, "Current mesurement INFO: Channel " + i + " is as expected. " +
              "reading == expected: " + current.channels[i] + " == " + 
              verification_current_vector.slice(0,4)[i]);            
            total_expected_channels_current += verification_current_vector.slice(0,4)[i];
          }
          if(current.total != total_expected_channels_current) {
            log(LOG_ERROR, "Current mesurement ERROR: total read current != total expected current: " +
                           current.total + " != " + total_expected_channels_current);
            stopScript(true);
            verification_phase = -1;
            break;    
          }
          log(LOG_INFO, "Current mesurement SUCCESS: Measured curent is as expected");
        }
      }
      if(verification_sub_phase >= 8*3+2) {
        log(LOG_INFO, "Current mesurement SUCCESS: All current measurements was as expected");
        current = undefined;
        load_status = undefined;
        switch_status = undefined;
        verification_phase++; 
        verification_sub_phase = 0;
        break;
      }
      current = undefined;
      load_status = undefined;
      switch_status = undefined;
      verification_sub_phase++;
      break;
 
 //TC-3: Loading with maximum non tripping load: 0.13*In
    case 3:
      if (waitTimer(0, 4)) return;
      if (verification_sub_phase == 0) {
        log(LOG_INFO, "============= Running maximum non tripping load: 0.13*In =============");
        verification_current_vector = [0,0,0,0,fuse_rating_setting*1.12/4,fuse_rating_setting*1.12/4,
                                      fuse_rating_setting*1.12/4,fuse_rating_setting*1.12/4];
        log(LOG_INFO, "1.13*In underload test INFO: Changing simulated current to " + verification_current_vector.slice(0,4));
        setSimulatedCurrent(verification_current_vector.slice(0,4));
      }
      else {
        if (verification_sub_phase >= 0 && verification_sub_phase % 3 == 0) { //0,3,6,9, ...
          log(LOG_INFO, "1.13*In underload test INFO: Changing simulated current to " + verification_current_vector.slice(0,4));
          verification_current_vector.push(verification_current_vector.splice(0,1)[0]); //rotate the current vactor left
          setSimulatedCurrent(verification_current_vector.slice(0,4));
        }
        if((verification_sub_phase-1) >= 0 && (verification_sub_phase-1) % 3 == 0) { // 1,4,7,10, ...
          log(LOG_INFO, "1.13*In underload test INFO: Reading overload info through RPC");
          getLoadStatus(function(result, error_code, error_message){load_status=result});
        }
        if((verification_sub_phase-2) >= 0 && (verification_sub_phase-2) % 3 == 0) { //2,5,8,11, ...
          if(!def(load_status)) {
            log(LOG_INFO, "1.13*In underload test ERROR: Failed to read over-load status");
            stopScript(true);
            verification_phase = -1;
            break;               
          }
          if(load_status.overLoadTime != -1) {
            log(LOG_INFO, "1.13*In underload test ERROR: Over-load not expected but detected");
            stopScript(true);
            verification_phase = -1;
            break;       
          }
          log(LOG_INFO, "1.13*In underload test SUCCESS: Over-load not expected and not detected");
        }
      }
      if(verification_sub_phase >= 8*3+2) {
        log(LOG_INFO, "1.13*In underload test SUCCESS: All current measurements was as expected");
        current = undefined;
        load_status = undefined;
        switch_status = undefined;
        verification_phase++; 
        verification_sub_phase = 0;
        break;
      }
      current = undefined;
      load_status = undefined;
      switch_status = undefined;
      verification_sub_phase++;
      break;

 //TC-4: Loading with minimum tripping load: 1.45*In
    case 4:
      //verification_phase++;  //The tescase does not pass
      //break;
      if (waitTimer(0, 4)) return;
      if (verification_sub_phase == 0) {
        log(LOG_INFO, "============= Running minimum tripping load: 1.45*In =============");
        verification_current_vector = [0,0,0,0,fuse_rating_setting*1.45/4,fuse_rating_setting*1.45/4,
                                      fuse_rating_setting*1.45/4,fuse_rating_setting*1.45/4];
        log(LOG_INFO, "1.45*In overload test INFO: Changing simulated current to " + verification_current_vector.slice(0,4));
        verification_sub_phase++;
        break;
      }
      //else {
      if (verification_sub_phase >= 0 && verification_sub_phase % 3 == 0) { //0,3,6,9, ...
        verification_current_vector.push(verification_current_vector.splice(0,1)[0]); //rotate the current vactor left
        log(LOG_INFO, "1.45*In overload test INFO: Changing simulated current to " + verification_current_vector.slice(0,4));
        setSimulatedCurrent(verification_current_vector.slice(0,4));
      }
      if((verification_sub_phase-1) >= 0 && (verification_sub_phase-1) % 3 == 0) { // 1,4,7,10, ...
        log(LOG_INFO, "1.45*In overload test INFO: Reading status info over RPC");
        getLoadStatus(function(result, error_code, error_message){load_status=result});
        let curr_sum = 0;
        verification_current_vector.slice(0,4).forEach(function(curr){curr_sum += curr});
        getTripTime(curr_sum, function(result, error_code, error_message) {verification_trip_data = result; print("Tripdata: " + JSON.stringify(result))});
        getSwitchStatus(function(result, error_code, error_message){switch_status = result});
      }
      if((verification_sub_phase-2) >= 0 && (verification_sub_phase-2) % 3 == 0) { //2,5,8,11, ...
        if(!def(load_status) || !def(verification_trip_data) || !def(switch_status)){
          log(LOG_INFO, "1.45*In overload test ERROR: Failed to read status");
          stopScript(true);
          verification_phase = -1;
          break;               
        }
      }
      if (verification_sub_phase < 3) {
        verification_sub_phase++;
        break;
      }
      
      if(verification_sub_phase <= 3*3+2 || verification_sub_phase >= 5*3+2 ) {
        if(verification_trip_data.tripTime != -1) {
          log(LOG_INFO, "1.45*In overload test ERROR: Triptime was expected to be -1-, but was " +
                         verification_trip_data.tripTime + " seconds for current " + verification_trip_data.current + " A");
          stopScript(true);
          verification_phase = -1;
          break;
        }
        if(load_status.overLoadTime != -1){
          log(LOG_ERROR, "1.45*In overload test ERROR: Over-load was not expected but reported");
          stopScript(true);
          verification_phase = -1;
          break;
        }
        if(switch_status.some(function(sw){return (sw.switchState == "off" && sw.shed) ? true:false})){
          log(LOG_ERROR, "1.45*In overload test ERROR: Some of the switches was unexpectedly reported off");
          stopScript(true);
          verification_phase = -1;
          break;
        }
        if(verification_sub_phase < 3*3+2 && load_status.coolDownTimeRemaining != -1) {
          log(LOG_ERROR, "1.45*In overload test ERROR: cool down time reported but not expected - reported: " + JSON.stringify(load_status));
          stopScript(true);
          verification_phase = -1;
          break;
        }
        if(verification_sub_phase >= 4*3+2 && verification_sub_phase <= 5*3+2 && load_status.coolDownTimeRemaining <= 0) {
          log(LOG_ERROR, "1.45*In overload test ERROR: cool down time was not > 0 as expected, reported: " + JSON.stringify(load_status));
          stopScript(true);
          verification_phase = -1;
          break;
        }
      }
      if(verification_sub_phase == 4*3+2) {
        if(verification_trip_data.tripTime <= 20) {
          log(LOG_ERROR, "1.45*In overload test ERROR: Triptime was expected to be > 20-, but was " +
                         verification_trip_data.tripTime  + " seconds for current " + verification_trip_data.current + " A");
          stopScript(true);
          verification_phase = -1;
          break;
        }
        if(load_status.overLoadTime == -1){
          log(LOG_ERROR, "1.45*In overload test ERROR: Overload was expected but was not reported"
          stopScript(true);
          verification_phase = -1;
          break;
        }
      }          
      if(verification_sub_phase >= 8*3+2) {
        log(LOG_INFO, "1.45*In overload test SUCCESS: Fuse is reportd to be overloaded as expected");
        current = undefined;
        load_status = undefined;
        switch_status = undefined;
        verification_phase++; 
        verification_sub_phase = 0;
        break;
      }
      else
        verification_sub_phase++;
      break;
 
 //TC-5: Shed test @ load: 1.45*In
 
    case 5:
      if (waitTimer(0, 1)) return;
      getSwitchStatus(function(result, error_code, error_message){switch_status = result});
      if (verification_sub_phase == 0) {
        log(LOG_INFO, "============= Shed test @ load: 1.45*In =============");
        verification_current_vector = [fuse_rating_setting*1.45/4,fuse_rating_setting*1.45/4,
                                      fuse_rating_setting*1.45/4,fuse_rating_setting*1.45/4];
        setSimulatedCurrent(verification_current_vector);
        verification_sub_phase++;
        break; 
      }
      if (verification_sub_phase < ~~(0.8*10)){
        if(!def(switch_status)) {
            log(LOG_ERROR, "1.45*In shed test ERROR: Could not obtain switch status");
            stopScript(true);
            verification_phase = -1;
            break;
        }        
        if(switch_status.some(function(sw){return (sw.switchState == "off" && sw.shed) ? true:false})) {
          log(LOG_ERROR, "1.45*In shed test ERROR: Unexpected early shedding happened"
          stopScript(true);
          verification_phase = -1;
          break;
        }
        else
          log(LOG_INFO, "1.45*In shed test INFO: Shedding did not happened prematurely");
      }
      if (verification_sub_phase == ~~(1.2*10)) {
        if(!def(switch_status)) {
          log(LOG_ERROR, "1.45*In shed test ERROR: Could not obtain switch status");
          stopScript(true);
          verification_phase = -1;
          break;
        }
        lowest_prio_chan = 0;
        for(let i=0; i<switch_status.length; i++) {
          if (switch_status[i].priority > switch_status[lowest_prio_chan].priority)
             lowest_prio_chan = i;
        }
        for(let i=0; i<switch_status.length; i++) {
          if (i == lowest_prio_chan && switch_status[i].switch_state === "on") {
            log(LOG_ERROR, "1.45*In shed test ERROR: Expeded channel " + i + "to have shedded but it reported " + switch_status[i].switch_state);
            stopScript(true);
            verification_phase = -1;
            break;
          }
          else
            log(LOG_INFO, "1.45*In shed test INFO: Channel " + i + "shedded as expected, reported state: " + switch_status[i].switch_state);
          if (i != lowest_prio_chan && switch_status[i].switch_state === "off" && switch_status[i].shed) {
            log(LOG_ERROR, "1.45*In shed test ERROR: Channel " + i + " was not expected to have shedded but it reported " + switch_status[i].switch_state);
            stopScript(true);
            verification_phase = -1;
            break;
          }
          else
            log(LOG_INFO, "1.45*In shed test : Channel " + i + " is not shedded as is expected, reported: " + switch_status[i].switch_state);
        }
        log(LOG_INFO, "1.45*In shed test INFO: Setting current to [0,0,0,0] and waiting for fuse to cool down and shedding to de-activate");
        setSimulatedCurrent([0,0,0,0]);
      }
      if (verification_sub_phase > ~~(1.2*10) + cool_down_time_setting*1.2) {
        if(!def(switch_status)) {
          log(LOG_ERROR, "1.45*In shed test ERROR: Could not obtain switch status");
          stopScript(true);
          verification_phase = -1;
          break;
        }
        for(let i=0; i<switch_status.length; i++) {
          if (switch_status[i].shed && switch_status[i].switch_state === "off") {
            log(LOG_ERROR, "1.45*In shed test ERROR: Didnt expeded channel " + i + "to still be sehedded " + switch_status[i].switch_state);
            stopScript(true);
            verification_phase = -1;
            break;
          }
        }
        log(LOG_INFO, "1.45*In shed test SUCCESS: Channel " + lowest_prio_chan + " shedded and reconnected as expected");
        current = undefined;
        load_status = undefined;
        switch_status = undefined;
        verification_phase++; 
        verification_sub_phase = 0;
        break;      
      }
      verification_sub_phase++;
      break;

//TC-6: Subsequent overloads @ load: 1.45*In
    case 6:
      if(waitTimer(0, 1)) return;
      if (!(verification_sub_phase % 2)){
        getSwitchStatus(function(result, error_code, error_message) {switch_status = result});
        getLoadStatus(function(result, error_code, error_message){load_status=result});
      }
      if (verification_sub_phase == 0) {
        log(LOG_INFO, "============= Running subsequent overloads @ Load: 1.13*In =============");
        verification_current_vector = [fuse_rating_setting*1.13/4,fuse_rating_setting*1.13/4,
                                       fuse_rating_setting*1.13/4,fuse_rating_setting*1.13/4];
        log(LOG_INFO, "1.13*In subsequent non shedding over-load test INFO: Changing simulated current to 1.13*In over-load " + verification_current_vector);
        setSimulatedCurrent(verification_current_vector);
      }
      if (verification_sub_phase == 4) {
        if(!noShed(switch_status)) {
          log(LOG_ERROR, "1.13*In subsequent non shedding over-load test ERROR: Did not expect shedding but got some: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;         
        }
        if(load_status.coolDownTimeRemaining <= 0 || load_status.overLoadTime != -1) {
          log(LOG_ERROR, "1.13*In subsequent non shedding over-load test ERROR: Expected coolDownTimeRemaining to be > 0 and overLoadTime to be == -1, but got: " + JSON.stringify(load_status));
          stopScript(true);
          verification_phase = -1;
          break;             
        }
        log(LOG_INFO, "1.13*In subsequent non shedding over-load test INFO: Did not expect shedding and didnt get any: " + JSON.stringify(switch_status));        
        log(LOG_INFO, "1.13*In subsequent non shedding over-load test INFO: setting current to [0,0,0,0]");
        setSimulatedCurrent([0,0,0,0]);
      } 
      if (verification_sub_phase == 8) {
        if(!noShed(switch_status)) {
          log(LOG_ERROR, "1.13*In subsequent non shedding over-load test ERROR: Did not expect shedding but got some: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;         
        }
        if(load_status.coolDownTimeRemaining <= 0 || load_status.overLoadTime != -1) {
          log(LOG_ERROR, "1.13*In subsequent non shedding over-load test ERROR: Expected coolDownTimeRemaining to be > 0 and overLoadTime to be == -1, but got: " + JSON.stringify(load_status));
          stopScript(true);
          verification_phase = -1;
          break;             
        }
        log(LOG_INFO, "1.13*In subsequent non shedding over-load test INFO: Did not expect shedding and didnt get any: " + JSON.stringify(switch_status));        
        log(LOG_INFO, "1.13*In subsequent non shedding over-load test INFO: setting current to 1.13*In: " + JSON.stringify(verification_current_vector));
        setSimulatedCurrent(verification_current_vector);
      }
      if (verification_sub_phase == 12) {
        if(!shed(switch_status, true, [getPrioChannel(switch_status, -1)])) {
          log(LOG_ERROR, "1.13*In subsequent non shedding over-load test ERROR: Expected shedding on (and only on) channel " + getPrioChannel(switch_status, -1) + " but got: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;         
        }
        if(load_status.coolDownTimeRemaining <= 0 || load_status.overLoadTime != -1) {
          log(LOG_ERROR, "1.13*In subsequent non shedding over-load test ERROR: Expected coolDownTimeRemaining to be > 0 and overLoadTime to be == -1, but got: " + JSON.stringify(load_status));
          stopScript(true);
          verification_phase = -1;
          break;             
        }
        log(LOG_INFO, "1.13*In subsequent non shedding over-load test INFO: Shedding happend only at the expected channel: " + getPrioChannel(switch_status, -1));        
        log(LOG_INFO, "1.13*In subsequent non shedding over-load test INFO: setting current to 0*In: " + JSON.stringify([0,0,0,0]) + " and waiting for fuse cooldown and channel " + getPrioChannel(switch_status, -1) + " reconnection");
        setSimulatedCurrent([0,0,0,0]);
      }
      if (verification_sub_phase == (12 + cool_down_time_setting * 1.2)) {
        if(!noShed(switch_status)){
          log(LOG_ERROR, "1.13*In subsequent non shedding over-load test ERROR: Did not expect shedding but got some: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;
        }
        if(load_status.coolDownTimeRemaining != -1 || load_status.overLoadTime != -1) {
          log(LOG_ERROR, "1.13*In subsequent non shedding over-load test ERROR: Expected coolDownTimeRemaining to be == -1 and overLoadTime to be == -1, but got: " + JSON.stringify(load_status));
          stopScript(true);
          verification_phase = -1;
          break;             
        }
        log(LOG_INFO, "1.13*In subsequent non shedding over-load test INFO: Did not expect shedding and didnt get any: " + JSON.stringify(switch_status));        
        log(LOG_INFO, "1.13*In subsequent non shedding over-load test SUCSESS: Shedding and non shedding happened when we where expecting it");        
        current = undefined;
        load_status = undefined;
        switch_status = undefined;
        verification_phase++; 
        verification_sub_phase = 0;
        break;
      }
      verification_sub_phase++
      break;

//TC-7: Short over-load: 4*10*In
    case 7:
      if(waitTimer(0, 1)) return;
      if (!(verification_sub_phase % 2)){
        getSwitchStatus(function(result, error_code, error_message) {switch_status = result});
        getLoadStatus(function(result, error_code, error_message){load_status=result});
      }
      if (verification_sub_phase == 0) {
        log(LOG_INFO, "============= Running short overload @ Load: 4*10*In =============");
        verification_current_vector = [fuse_rating_setting*10,fuse_rating_setting*10,
                                       fuse_rating_setting*10,fuse_rating_setting*10];
        log(LOG_INFO, "4*10*In short overload test INFO: Changing simulated current to 4*10*In over-load " + verification_current_vector);
        setSimulatedCurrent(verification_current_vector);
      }
      if (verification_sub_phase == 4) {
        if(!shed(switch_status)) {
          log(LOG_ERROR, "4*10*In short overload test ERROR: Expected all channels to have been shedded but got some that did not: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;         
        }
        if(load_status.coolDownTimeRemaining <= 0 || load_status.overLoadTime <= 0) {
          log(LOG_ERROR, "4*10*In short overload test ERROR: Expected coolDownTimeRemaining to be > 0 and overLoadTime to be > 0, but got: " + JSON.stringify(load_status));
          stopScript(true);
          verification_phase = -1;
          break;             
        }
        log(LOG_INFO, "4*10*In short overload test INFO: Expected shedding of all channels and got it: " + JSON.stringify(switch_status));        
        log(LOG_INFO, "4*10*In short overload test INFO: setting current to [0,0,0,0]");
        setSimulatedCurrent([0,0,0,0]);
      } 
      if (verification_sub_phase == (4 + 3*time_to_test_loading_setting*1.2)) {
        if(!noShed(switch_status)){
          log(LOG_ERROR, "4*10*In short overload test ERROR: Did not expect shedding but got some: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;
        }
        if(load_status.coolDownTimeRemaining != -1 || load_status.overLoadTime != -1) {
          log(LOG_ERROR, "4*10*In short overload test ERROR: Expected coolDownTimeRemaining to be == -1 and overLoadTime to be == -1, but got: " + JSON.stringify(load_status));
          stopScript(true);
          verification_phase = -1;
          break;             
        }
        log(LOG_INFO, "4*10*In short overload test INFO: Did not expect shedding and didnt get any: " + JSON.stringify(switch_status));        
        log(LOG_INFO, "4*10*In short overload test SUCSESS: Shedding and non shedding happened when we where expecting it");        
        current = undefined;
        load_status = undefined;
        switch_status = undefined;
        verification_phase++; 
        verification_sub_phase = 0;
        break;
      }
      verification_sub_phase++
      break;

//TC-8: Subsequent Prio over-load: ......
    case 8:
      if(waitTimer(0, 1)) return;
      if (!(verification_sub_phase % 2)){
        getSwitchStatus(function(result, error_code, error_message) {switch_status = result});
        getLoadStatus(function(result, error_code, error_message){load_status=result});
      }
      if (verification_sub_phase == 0) {
        log(LOG_INFO, "============= Subsequent Prio over-load @ Load: various =============");
        
        verification_current_vector = [fuse_rating_setting*1.13/3,fuse_rating_setting*1.13/3,
                                       fuse_rating_setting*1.13/3,fuse_rating_setting/4];
        log(LOG_INFO, "Subsequent Prio over-load test INFO: Changing simulated current to " + verification_current_vector);
        setSimulatedCurrent(verification_current_vector);
      }
      if (verification_sub_phase == 20) {
        if(!shed(switch_status, true, [3])) {
          log(LOG_ERROR, "Subsequent Prio over-load test ERROR: Expected channel 3 to have been shedded but got some that did not: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;         
        }
        if(load_status.coolDownTimeRemaining <= 0 || load_status.overLoadTime != -1) {
          log(LOG_ERROR, "Subsequent Prio over-load test ERROR: Expected coolDownTimeRemaining to be > 0 and overLoadTime to be == -1, but got: " + JSON.stringify(load_status));
          stopScript(true);
          verification_phase = -1;
          break;             
        }
        log(LOG_INFO, "Subsequent Prio over-load test INFO: Expected shedding of channel 3 and got it: " + JSON.stringify(switch_status));        
        verification_current_vector = [fuse_rating_setting*1.13/2,fuse_rating_setting*1.13/2,
                                       fuse_rating_setting/4,0];
        log(LOG_INFO, "Subsequent Prio over-load test INFO: setting current to " + verification_current_vector);
        setSimulatedCurrent(verification_current_vector);
      } 
      
      if (verification_sub_phase == 40) {
        if(!shed(switch_status, true, [3, 2])) {
          log(LOG_ERROR, "Subsequent Prio over-load test ERROR: Expected channels 3 and 2 to have been shedded but got some that did not: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;         
        }
        if(load_status.coolDownTimeRemaining <= 0 || load_status.overLoadTime != -1) {
          log(LOG_ERROR, "Subsequent Prio over-load test ERROR: Expected coolDownTimeRemaining to be > 0 and overLoadTime to be == -1, but got: " + JSON.stringify(load_status));
          stopScript(true);
          verification_phase = -1;
          break;             
        }
        log(LOG_INFO, "Subsequent Prio over-load test INFO: Expected shedding of channel 3 & 2 and got it: " + JSON.stringify(switch_status));        
        verification_current_vector = [fuse_rating_setting*1.13,fuse_rating_setting/4,
                                       0,0];
        log(LOG_INFO, "Subsequent Prio over-load test INFO: setting current to " + verification_current_vector);                        
        setSimulatedCurrent(verification_current_vector);
      }
      
      if (verification_sub_phase == 60) {
        if(!shed(switch_status, true, [3, 2, 1])) {
          log(LOG_ERROR, "Subsequent Prio over-load test ERROR: Expected channels 3, 2 and 1 to have been shedded but got some that did not: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;         
        }
        if(load_status.coolDownTimeRemaining <= 0 || load_status.overLoadTime != -1) {
          log(LOG_ERROR, "Subsequent Prio over-load test ERROR: Expected coolDownTimeRemaining to be > 0 and overLoadTime to be == -1, but got: " + JSON.stringify(load_status));
          stopScript(true);
          verification_phase = -1;
          break;             
        }
        log(LOG_INFO, "Subsequent Prio over-load test INFO: Expected shedding of channel 3, 2 and 1 and got it: " + JSON.stringify(switch_status));        
        verification_current_vector = [fuse_rating_setting*2,0,
                                       0,0];
        log(LOG_INFO, "Subsequent Prio over-load test INFO: setting current to " + verification_current_vector);                        
        setSimulatedCurrent(verification_current_vector);
      }
      
      if (verification_sub_phase == 80) {
        if(!shed(switch_status, true, [3, 2, 1])) {
          log(LOG_ERROR, "Subsequent Prio over-load test ERROR: Expected channels 3, 2 and 1 to have been shedded but got some that did not: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;         
        }
        if(load_status.coolDownTimeRemaining <= 0 || load_status.overLoadTime <= 0) {
          log(LOG_ERROR, "Subsequent Prio over-load test ERROR: Expected coolDownTimeRemaining to be > 0 and overLoadTime to be > 0, but got: " + JSON.stringify(load_status));
          stopScript(true);
          verification_phase = -1;
          break;             
        }
        log(LOG_INFO, "Subsequent Prio over-load test INFO: Expected shedding of channel 3, 2 and 1 and got it: " + JSON.stringify(switch_status));        
        verification_current_vector = [0,0,0,0];
        log(LOG_INFO, "Subsequent Prio over-load test INFO: setting current to " + verification_current_vector);                        
        setSimulatedCurrent(verification_current_vector);
      }      
      if (verification_sub_phase == 100) {
        if(!noShed(switch_status)){
          log(LOG_ERROR, "Subsequent Prio over-load test ERROR: Did not expect shedding but got some: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;
        }
        if(load_status.coolDownTimeRemaining != -1 || load_status.overLoadTime != -1) {
          log(LOG_ERROR, "Subsequent Prio over-load test ERROR: Expected coolDownTimeRemaining to be == -1 and overLoadTime to be == -1, but got: " + JSON.stringify(load_status));
          stopScript(true);
          verification_phase = -1;
          break;             
        }
        log(LOG_INFO, "Subsequent Prio over-load test INFO: Did not expect shedding and didnt get any: " + JSON.stringify(switch_status));        
        log(LOG_INFO, "Subsequent Prio over-load test SUCSESS: Shedding and non shedding happened when we where expecting it");        
        current = undefined;
        load_status = undefined;
        switch_status = undefined;
        verification_phase++; 
        verification_sub_phase = 0;
        break;
      }
      verification_sub_phase++
      break;

    default:
      return;
  }

}

/*********************************************************************************************************/
/*                                              main/init                                                */
/*********************************************************************************************************/
Shelly.addEventHandler(shellyEventCb);
Timer.set(scan_interval*1000, true, verificationEngine);
