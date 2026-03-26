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
  //print("ping");
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
          setCurrentRestriction(-1);
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
      if (def(current) && def(switch_status) && def(load_status) && current.total == 0 &&
        !switch_status.some(function(sw) {return sw.switchState == "on";}) && 
        load_status.overLoadTime == -1 && load_status.coolDownTimeRemaining == -1) {
        log(LOG_INFO, "Stabelizing SUCCESS: Shedder has stabelized");
        current = undefined;
        load_status = undefined;
        switch_status = undefined;
        verification_phase = 9; 
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
      


//TC-9; Test-loading
    case 9:
      if(waitTimer(0, 1)) return;
      if (!(verification_sub_phase % 2)){
        getSwitchStatus(function(result, error_code, error_message) {switch_status = result});
        getLoadStatus(function(result, error_code, error_message){load_status=result});
      }
      if (verification_sub_phase == 0) {
        log(LOG_INFO, "============= Test-loading @ Load: 4*10 In =============");
        
        verification_current_vector = [fuse_rating_setting*10,fuse_rating_setting*10,
                                       fuse_rating_setting*10,fuse_rating_setting*10];
        log(LOG_INFO, "4*10 In test-loading test INFO: Changing simulated current to " + verification_current_vector);
        setSimulatedCurrent(verification_current_vector);
      }  
      if (verification_sub_phase == 4) {
        if(!shed(switch_status, true, [3, 2, 1])) {
          log(LOG_ERROR, "4*10 In test-loading test ERROR: Expected chedding of chanel 1, 2 and 3 but got some: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;
        }
        verification_current_vector = [0,0,0,0];
        log(LOG_INFO, "4*10 In test-loading test INFO: Changing simulated current to " + verification_current_vector);
        log(LOG_INFO, "4*10 In test-loading test INFO: Waiting for time_to_test_loading_setting*: ~" + (~~time_to_test_loading_setting*0.8) + " seconds before next check.");
        setSimulatedCurrent(verification_current_vector);
      }
      if (verification_sub_phase == ~~(4 + time_to_test_loading_setting*0.8/1.5)) {
        if(!shed(switch_status, true, [3, 2, 1])) {
          log(LOG_ERROR, "4*10 In test-loading test ERROR: Expected chedding of chanel 1, 2 and 3 but got " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;
        }
        log(LOG_INFO, "4*10 In test-loading test INFO: Channel 1, 2 and 3 shedded as expected.");

      }
      if (verification_sub_phase == ~~(4 + time_to_test_loading_setting*1.2/1.5)) {
        if(!shed(switch_status, true, [3, 2])) {
          log(LOG_ERROR, "4*10 In test-loading test ERROR: Expected chedding of chanel 2 and 3 but got: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;
        }
        log(LOG_INFO, "4*10 In test-loading test INFO: Channel 2 and 3 shedded as expected.");
      }
      if (verification_sub_phase == ~~(4 + 2*time_to_test_loading_setting*0.8/1.5)) {
        if(!shed(switch_status, true, [3, 2])) {
          log(LOG_ERROR, "4*10 In test-loading test ERROR: Expected chedding of chanel 2 and 3 but got: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;
        }
        log(LOG_INFO, "4*10 In test-loading test INFO: Channel 2 and 3 shedded as expected.");
      }
      if (verification_sub_phase == ~~(4 + 2*time_to_test_loading_setting*1.2/1.5)) {
        if(!shed(switch_status, true, [3])) {
          log(LOG_ERROR, "4*10 In test-loading test ERROR: Expected chedding of chanel 3 but got: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;
        }
        log(LOG_INFO, "4*10 In test-loading test INFO: Channel 3 shedded as expected.");
      }
      if (verification_sub_phase == ~~(4 + 3*time_to_test_loading_setting*0.8/1.5)) {
        if(!shed(switch_status, true, [3])) {
          log(LOG_ERROR, "4*10 In test-loading test ERROR: Expected chedding of chanel 3 but got: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;
        }
        log(LOG_INFO, "4*10 In test-loading test INFO: Channel 3 shedded as expected.");
      }
      if (verification_sub_phase == ~~(4 + 3*time_to_test_loading_setting*1.2/1.5)) {
        if(!noShed(switch_status)) {
          log(LOG_ERROR, "4*10 In test-loading test ERROR: Didn't expect any shed but got: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;
        }
        log(LOG_INFO, "4*10 In test-loading test INFO: No channel shedded as expected.");
        log(LOG_INFO, "4*10 In test-loading test SUCCESS: Test-loading happend as expected");
        current = undefined;
        load_status = undefined;
        switch_status = undefined;
        verification_phase++; 
        verification_sub_phase = 0;
        break;
      }
      verification_sub_phase++;
      break; 


//TC-10; NB Current restriction
    case 10:
      if(waitTimer(0, 1)) return;
      if (!(verification_sub_phase % 2)) {
        getSwitchStatus(function(result, error_code, error_message) {switch_status = result});
        getLoadStatus(function(result, error_code, error_message){load_status=result});
      }
      if (verification_sub_phase == 0) {
        log(LOG_INFO, "============= NB current restriction @ Load: In =============");
        
        verification_current_vector = [fuse_rating_setting/4,fuse_rating_setting/4,
                                       fuse_rating_setting/4,fuse_rating_setting/4];
        log(LOG_INFO, "NB current restriction test INFO: Changing simulated current to " + verification_current_vector);
        setSimulatedCurrent(verification_current_vector);
      }
      
      if (verification_sub_phase == 4) {        
        if(!noShed(switch_status)) {
          log(LOG_ERROR, "NB current restriction test ERROR: Didn't expect any shed but got: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;
        }
        log(LOG_INFO, "NB current restriction test INFO: got no shedding as expected");
        log(LOG_INFO, "NB current restriction test INFO: Setting current restriction to In*3/4");
        setCurrentRestriction(fuse_rating_setting*3/4);
      }
      
      if (verification_sub_phase == 8) {        
        if(!shed(switch_status, true, [3])) {
          log(LOG_ERROR, "NB current restriction test ERROR: Expected channel 3 to be shedded but got: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;
        }
        log(LOG_INFO, "NB current restriction test INFO: Channel 3 was sechedded as expected");
        log(LOG_INFO, "NB current restriction test INFO: Setting current restriction to In*2/4");
        setCurrentRestriction(fuse_rating_setting*2/4);
      }
      
      if (verification_sub_phase == 12) {        
        if(!shed(switch_status, true, [2, 3])) {
          log(LOG_ERROR, "NB current restriction test ERROR: Expected channel 2 and 3 to be shedded but got: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;
        }
        log(LOG_INFO, "NB current restriction test INFO: Channel 2 and 3 was sechedded as expected");
        log(LOG_INFO, "NB current restriction test INFO: Setting current restriction to In*1/4");
        setCurrentRestriction(fuse_rating_setting*1/4);
      }
      
      if (verification_sub_phase == 16) {        
        if(!shed(switch_status, true, [1, 2, 3])) {
          log(LOG_ERROR, "NB current restriction test ERROR: Expected channel 1, 2 and 3 to be shedded but got: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;
        }
        log(LOG_INFO, "NB current restriction test INFO: Channel 1, 2 and 3 was sechedded as expected");
        log(LOG_INFO, "NB current restriction test INFO: Setting current restriction to 0");
        setCurrentRestriction(0);
      }
      
       if (verification_sub_phase == 20) {        
        if(!shed(switch_status, true, [1, 2, 3])) {
          log(LOG_ERROR, "NB current restriction test ERROR: Expected channel 1, 2 and 3 to be shedded but got: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;
        }
        log(LOG_INFO, "NB current restriction test INFO: Channel 1, 2 and 3 was sechedded as expected");
        log(LOG_INFO, "NB current restriction test INFO: Setting current restriction In*2/4");
        setCurrentRestriction(fuse_rating_setting*2/4);
      }     

      if (verification_sub_phase == 24) {        
        if(!shed(switch_status, true, [1, 2, 3])) {
          log(LOG_ERROR, "NB current restriction test ERROR: Expected channel 1, 2 and 3 to be shedded but got: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;
        }
        log(LOG_INFO, "NB current restriction test INFO: Channel 1, 2 and 3 was sechedded as expected");
        log(LOG_INFO, "NB current restriction test INFO: Setting current restriction to In*2/4*1.1");
        setCurrentRestriction(fuse_rating_setting*2/4*1.1);
      }
      
      if (verification_sub_phase == 28) {        
        if(!shed(switch_status, true, [2, 3])) {
          log(LOG_ERROR, "NB current restriction test ERROR: Expected channel 2 and 3 to be shedded but got: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;
        }
        log(LOG_INFO, "NB current restriction test INFO: Channel 2 and 3 was sechedded as expected");
        log(LOG_INFO, "NB current restriction test INFO: Setting current restriction to -1 (None)");
        setCurrentRestriction(-1);
      }
      
      if (verification_sub_phase == 32) {        
        if(!noShed(switch_status)) {
          log(LOG_ERROR, "NB current restriction test ERROR: Didn't expect any channel to be shedded but got: " + JSON.stringify(switch_status));
          stopScript(true);
          verification_phase = -1;
          break;
        }
        log(LOG_INFO, "NB current restriction test INFO: No channel shedded as expected." + JSON.stringify(switch_status));
        log(LOG_INFO, "NB current restriction test SUCCESS: Shedding happend as expected");
        current = undefined;
        load_status = undefined;
        switch_status = undefined;
        verification_phase++; 
        verification_sub_phase = 0;
        break;
      }
      verification_sub_phase++;
      break;
      
//TC-11: API testing
    case 11:
      if(waitTimer(0, 1)) return;
      if (verification_sub_phase == 0) {
        log(LOG_INFO, "============= HTTP API test =============");
        log(LOG_INFO, "Factory reset INFO: Starting a factory reset");
        factoryReset();
      }
      
      if (verification_sub_phase == 4) {
        print("Checking 1");
        Shelly.call("Script.List", null,
        function(result, error_code, error_message){
          print(JSON.stringify(result));
          for(let i=0; i<result.scripts.length;i++){
            if(result.scripts[i].name = "shedder") {
              if(result.scripts[i].running) {
                log(LOG_ERROR, "Factory reset ERROR: Script did not stop");
                stopScript(true);
                verification_phase = -1;
              }
              else {
                log(LOG_ERROR, "Factory reset ERROR: Script stopped as expected");
              }
            }
          }
        }
        );
        print("Checking 2");

        Shelly.call("KVS.Get", {key:"scan_interval"},
        function(result, error_code, error_message){
          print(JSON.stringify(result));
          /*for(let i=0; i<result.scripts.length;i++){
            if(result.scripts[i].name = "shedder") {
              if(result.scripts[i].running) {
                log(LOG_ERROR, "Factory reset ERROR: Script did not stop");
                stopScript(true);
                verification_phase = -1;
              }
            }
          }*/
        }
        );     
      }
      
      if (verification_sub_phase == 11) {
        //log(LOG_INFO, "Factory reset INFO: Starting a factory reset");
        current = undefined;
        load_status = undefined;
        switch_status = undefined;
        verification_phase++; 
        verification_sub_phase = 0;
        break;
      }
      verification_sub_phase++;
      break;
      
//11.1 Factory reset - http://"ShellyURL"/script//shedder?factory_reset_to_default
//11.2 Restart - http://"ShellyURL"/script//shedder?=restart
//11.3 Current restriction (Already verified in TC 10)
//11.4 Simulation (Already tested in TC 1)
//11.5 Set simulated current (Already tested in earlier TCs)
//11.6 Get current status (Already tested in TC...)
//11.7 Get load status (Already tested in earlier TCs)
//11.8 Get fuse trip time (Already tested in earlier TC)
//11.9 Get switch status (Already tested in earlier TC)
//TC-12 Asynchronous HTTP RPC callbacks
//TC-13 KVS configuration and script ID identification
//TC-14 169h Stability/Robustness test: ......

    default:
      return;
  }
}

/*********************************************************************************************************/
/*                                              main/init                                                */
/*********************************************************************************************************/
Shelly.addEventHandler(shellyEventCb);
Timer.set(scan_interval*1000, true, verificationEngine);

/*********************************************************************************************************/
/*                                              main/init                                                */
/*********************************************************************************************************/
Shelly.addEventHandler(shellyEventCb);
Timer.set(scan_interval*1000, true, verificationEngine);
