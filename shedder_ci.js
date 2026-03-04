let verification_phase = 0;
let verification_sub_phase = 0;
let verification_sub_sub_phase = 0;
let verification_current_vector = new Array(8);
let verification_trip_time = 0;
let wait_for_shed = 0;
let wait_for_cool = 0;
let calls = 0;
let shelly_call_records = [];

/********************************************    Constants ***********************************************/
const LOG_VERBOSE = 0;
const LOG_INFO = 1;
const LOG_WARN = 2;
const LOG_ERROR = 3;
const LOG_CRITICAL = 4;
const CALL_LIMIT = 5;
/*********************************************************************************************************/

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
    print(log_entry);
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
                      //print(call_record.meth);
                      //print(call_record.meth_param);
		              //shelly_call_records.splice(0, 1);
		              if (shelly_call_records.length && calls == CALL_LIMIT-2){
		                Shelly.emitEvent("continueExecQueuedShellyCalls", {});
		                log(LOG_INFO, "Resuming calls");
		              }
                }, shelly_call_records[0]
    );
    shelly_call_records.splice(0, 1);
    if (shelly_call_records.length)
      Shelly.emitEvent("continueExecQueuedShellyCalls", {}); 
  }
  else {
    log(LOG_INFO, "Max calls reached, pausing calls");
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
  //print("event.component" + event.component);
  //print("event.info" + event.info);
  //print("event.info.event" + event.info.event);
  //print("Component " + Object.keys(event.component)[0]);
  //print("JSON " + JSON.stringify(event))
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

macro waitTimer(timer_id, time) {
  if (timer[timer_id] == 0)
    timer[timer_id] = ~~(time/scan_interval);
  else {
    timer[timer_id]--;
    if (timer[timer_id] != 0)
      return;
  }
}
/* function reboot()
 * Reboots the Shelly */
function reboot() {
  Shelly.Reboot();
}

function backupKVS(backup, fun) {
  queueShellyCall("KVS.GetMany", {match:"*"}, 
                  function (result, error_code, error_message, fun) {
                    backup = result;
                    if (def(fun))
                      fun(result, error_code, error_message);
                  },
                  fun
                  );
}
   
function KVSSet(key_values, cb) {
  if(set_cnt != 0)
    return -1;
  queueShellyCall("KVS.GetMany", {match:"*"}, 
                  function (result, error_code, error_message, params) {
                    for(key in params.key_values){
                      set_cnt++;
                      if(result.key != params.key_values.key) {
                        queueShellyCall("KVS.Set", key ,
                                        function(result, error_code, error_message, cb) {
                                          set_cnt--;
                                          if(!set_cnt)
                                            cb();
                                          return;
                                        },
                                        params.cb;
                                        );
                      }
                    }
                  return;
                  },
                  {cb:cb, key_values:key_values}
                  );
  return 0;
}

function setCurrentRestriction(current_restriction, cb) {
  queueShellyCall("HTTP.SET", {url:"http://localhost/shelly/script/" + target_script_id +
                              "/shedder?setCurrentRestriction=" + restriction}, 
                  function (result, error_code, error_message, cb) {
                    if(def(cb))
                      cb(result, error_code, error_message);
                    return;
                  },
                  cb
                  );
}

function setSimulation(simulation, cb) {
  queueShellyCall("HTTP.SET", {url:"http://localhost/shelly/script/" + target_script_id +
                              "/shedder?simulation=" + simulation}, 
                  function (result, error_code, error_message, cb) {
                    if(def(cb))
                      cb(result, error_code, error_message);
                    return;
                  },
                  cb
                  );  
}

function setCurrent(current, cb) {
  queueShellyCall("HTTP.SET", {url:"http://localhost/shelly/script/" + target_script_id +
                              "/shedder?setSimulatedCurrent=" + current}, 
                  function (result, error_code, error_message, cb) {
                    if(def(cb))
                      cb(result, error_code, error_message);
                    return;
                  },
                  cb
                  );
  
}

function getCurrent(current, cb) {
  queueShellyCall("HTTP.GET", {url:"http://localhost/shelly/script/" + target_script_id +
                              "/shedder?getCurrent"}, 
                  function (result, error_code, error_message, cb) {
                    if(def(cb))
                      cb(result, error_code, error_message);
                    return;
                  },
                  cb
                  );
  
}

function getSwitchState(switch_state, cb) {
  queueShellyCall("HTTP.GET", {url:"http://localhost/shelly/script/" + target_script_id +
                              "/shedder?getSwitchState"}, 
                  function (result, error_code, error_message, cb) {
                    if(def(cb))
                      cb(result, error_code, error_message);
                    return;
                  },
                  cb
                  );
}

function getLoadState(load_state, cb) {
  queueShellyCall("HTTP.GET", {url:"http://localhost/shelly/script/" + target_script_id +
                              "/shedder?getLoadState"}, 
                  function (result, error_code, error_message, cb) {
                    if(def(cb))
                      cb(result, error_code, error_message);
                    return;
                  },
                  cb
                  );
}
/*********************************************************************************************************/


function setup(){
  KVSBackup = backupKVS();
  KVSSet({fuse_rating_setting:16, fuse_char_setting:"C", margin_factor_setting:4,
          cool_down_time_setting:10, time_to_test_loading_setting:30,
          current_restriction_hysteresis_setting:0.1, log_level_setting:LOG_INFO});
  setCurrentRestriction(-1);
  setSimulation(true);
  setCurrent([0,0,0,0]);
  verification_phase = 0;
  verification_sub_phase = 0;
}



/*********************************************************************************************************/
/*                                         CI/CD verification                                            */
/*********************************************************************************************************/

function verificationEngine() {
  switch (verification_phase ) {

//TC-0: Stabelizion Shedder
    case 0:
      waitTimer(0,5);
      if(verification_sub_phase == 0) {
        log(LOG_INFO, "============= Waiting for shedder to stabelize =============");
      }
      getCurrent(current);
      getSwitchState(switch_state);
      getLoadStatus(load_status);
      if (def(current) && def(switch_state) && def(load_status) && current.total == 0 &&
        !switch_state.switch_state.some(function(switch){return switch == "on"" ? true:false}) && 
        load_status.overLoadTime == -1, load_status.coolDownTime == -1) {
        log(LOG_INFO, "Stabelizing SUCCESS: Shedder has stabelized");
        current = undefined;
        load_status = undefined;
        switch_state = undefined;
        verification_phase++; 
        verification_sub_phase = 0;
        break;
      }
      if(verification_sub_phase >= 60) {
        log(LOG_ERROR, ""Stabelizing ERROR: Shedder has not stabelized 5 minutes");
        stopScript(true);
        verification_phase = -1;
        break;
      }
      verification_sub_phase++;
      break;
      
//TC-1: Current measurement
    case 1:
      waitTimer(0,0.5);
      if (verification_sub_phase == 0) {
        log(LOG_INFO, "============= Running Current measurement test =============");
        verification_current_vector = [0,0,0,0,1,1,1,1];
        log(LOG_INFO, "Load mesurement INFO: Changing simulated current to " + verification_current_vector.slice(0,4));
        setSimulatedCurrent(verification_current_vector.slice(0,4));
      }
      else {
        if (verification_sub_phase >= 0 && verification_sub_phase % 3 == 0) { //0,3,6,9, ...
          verification_current_vector.push(verification_current_vector.splice(0,1)); //rotate the current vactor left
          log(LOG_INFO, "Current mesurement INFO: Changing simulated current to " + verification_current_vector.slice(0,4));
          setSimulatedCurrent(verification_current_vector.slice(0,4));
        }
        if(verification_sub_phase-1 >= 0 && verification_sub_phase-1 % 3 == 0) { // 1,4,7,10, ...
          log(LOG_INFO, "Current mesurement INFO: Reading current through RPC");
          getCurrent(current);
        }
        if(verification_sub_phase-2 >= 0 && verification_sub_phase-2 % 3 == 0) { //2,5,8,11, ...
          if(!def(current)) {
            log(LOG_ERROR, "Current mesurement ERROR: Current reading failed");
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
            log(LOG_ERROR, "Current mesurement ERROR: total read current != total expected current:" +
                           current.total + " != " + total_expected_channels_current);
            stopScript(true);
            verification_phase = -1;
            break;    
          }
          log(LOG_INFO, "Current mesurement SUCCESS: Measured curent is as expected");
        }
      }
      if(verification_sub_phase >= 8*3) {
        log(LOG_INFO, "Current mesurement SUCCESS: All current measurements was as expected");
        current = undefined;
        load_status = undefined;
        switch_state = undefined;
        verification_phase++; 
        verification_sub_phase = 0;
        break;
      }
      current = undefined;
      load_status = undefined;
      switch_state = undefined;
      verification_sub_phase++;
      break;
     
 //TC-3: Loading with maximum non tripping load: 0.13*In
    case 3:
      waitTimer(0, 2);
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
          simulated_current = verification_current_vector.slice(0,4);
        }
        if(verification_sub_phase-1 >= 0 && verification_sub_phase-1 % 3 == 0) { // 1,4,7,10, ...
          log(LOG_INFO, "1.13*In underload test INFO: Reading overload info through RPC");
          getLoadStatus(load_status);
        }
        if(verification_sub_phase-2 >= 0 && verification_sub_phase-2 % 3 == 0) { //2,5,8,11, ...
          if(!def(load_status)){
            log(LOG_INFO, "1.13*In underload test ERROR: Failed to read over-load status");
            stopScript(true);
            verification_phase = -1;
            break;               
          }
          if(load_status.overLoadTime != -1){
          if(!def(load_status)){
            log(LOG_INFO, "1.13*In underload test ERROR: Over-load not expected but detected");
            stopScript(true);
            verification_phase = -1;
            break;       
          }
          log(LOG_INFO, "1.13*In underload test SUCCESS: Over-load not expected and not detected");
        }
      }
      if(verification_sub_phase >= 8*3-1) {
        log(LOG_INFO, "1.13*In underload test SUCCESS: All current measurements was as expected");
        current = undefined;
        load_status = undefined;
        switch_state = undefined;
        verification_phase++; 
        verification_sub_phase = 0;
        break;
      }
      current = undefined;
      load_status = undefined;
      switch_state = undefined;
      verification_sub_phase++;
      break;

 //TC-4: Loading with minimum tripping load: 1.45*In
    case 4:
      waitTimer(0, 2);
      if (verification_sub_phase == 0) {
        log(LOG_INFO, "============= Running minimum tripping load: 1.45*In =============");
        verification_current_vector = [0,0,0,0,fuse_rating_setting*1.45/4,fuse_rating_setting*1.45/4,
                                      fuse_rating_setting*1.45/4,fuse_rating_setting*1.45/4];
        log(LOG_INFO, "1.45*In overload test INFO: Changing simulated current to " + verification_current_vector.slice(0,4));
        setSimulatedCurrent(verification_current_vector.slice(0,4));
      }
      else {
        if (verification_sub_phase >= 0 && verification_sub_phase % 3 == 0) { //0,3,6,9, ...
          log(LOG_INFO, "1.45*In overload test INFO: Changing simulated current to " + verification_current_vector.slice(0,4));
          simulated_current = verification_current_vector.slice(0,4);
        }
        if(verification_sub_phase-1 >= 0 && verification_sub_phase-1 % 3 == 0) { // 1,4,7,10, ...
          log(LOG_INFO, "1.45*In overload test INFO: Reading status info over RPC");
          getLoadStatus(load_status);
          getTripTime(trip_time);
          getSwitchState(switch_state);
        }
        if(verification_sub_phase-2 >= 0 && verification_sub_phase-2 % 3 == 0) { //2,5,8,11, ...
          if(!def(load_status) || !def(trip_time) || !def(switch_state)){
            log(LOG_INFO, "1.45*In overload test: Failed to read status");
            stopScript(true);
            verification_phase = -1;
            break;               
          }
          if(verification_sub_phase != 4*3-1) {
             if(trip_time != -1) {
                log(LOG_INFO, "1.45*In overload test ERROR: Triptime was expected to be -1-, but was " +
                             trip_time + " seconds");
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
            if(switch_status.some(function(switch){return (switch.switch_state == "off" && switch.shed) ? true:false})){
              log(LOG_ERROR, "1.45*In overload test ERROR: Some of the switches was unexpectedly reported off");
              stopScript(true);
              verification_phase = -1;
              break;
            }
          }
          else {
            if(trip_time != 90){
              log(LOG_ERROR, "1.45*In overload test ERROR: Triptime was expected to be 90-, but was " +
                             trip_time + " seconds");
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
            log(LOG_INFO, "1.45*In overload test INFO: Fuse is reportd to be overloaded as expected");
            current = undefined;
            load_status = undefined;
            switch_state = undefined;
            verification_phase++; 
            verification_sub_phase = 0;
            break;
          }
        }
      }
      verification_sub_phase++;
      break;
      
 //TC-5: Shed test @ load: 1.45*In
    case 5:
      waitTimer(0, 0.5);
      getSwitchStatus(switch_status);
      if (verification_sub_phase == 0) {
        log(LOG_INFO, "============= Shed test @ load: 1.45*In =============");
        verification_sub_phase++;
        break; 
      }
      if(!def(switch_status) {
          log(LOG_ERROR, "1.45*In shed test ERROR: Could not obtain switch status");
          stopScript(true);
          verification_phase = -1;
          break;
      }
      if (verification_sub_phase < ~~(0.8*90/(0.5*margin_factor))){
        if(switch_status.some(function(switch){return (switch.switch_state == "off" && switch.shed) ? true:false})){
          log(LOG_ERROR, "1.45*In shed test ERROR: Unexpected early shedding happened"
          stopScript(true);
          verification_phase = -1;
          break;
        }
      }
      if (verification_sub_phase == ~~(1.2*90/(0.5*margin_factor))) {
        let found_first_sheddable = false;
        let correct_shedding = true;
        for(let i=0; < switch_status.length; i++) {
          if(found_first_sheddable) {
            if(switch_status.shed && switch_status.switch_state == "off")
              correct_shedding = false;
          }
          else if(switch_status.shed) {
            found_first_sheddable = true;
            if(switch_status.switch_state == "on")
              correct_shedding = false;
          }
        }
        if(!correct_shedding){
          log(LOG_ERROR, "1.45*In shed test ERROR: Shedding did not happen in time");
          stopScript(true);
          verification_phase = -1;
          break;
        } 
        else {
         log(LOG_INFO, "1.45*In shed test SUCCESS: Correct shedding in time");
         current = undefined;
         load_status = undefined;
         switch_state = undefined;
         verification_phase++; 
         verification_sub_phase = 0;
         break; 
        }
      }
      verification_sub_phase++
      break;

 //TC-6: Cool-down @ load: 3/4*1.45*In
    case 6:
      waitTimer(0, 0.5);
      getSwitchStatus(switch_status);
      getLoadStatus(load_status);
      if (verification_sub_phase == 0) {
        log(LOG_INFO, "============= Cool-down test @ load: 3/4*1.45*In =============");
        verification_current_vector = [fuse_rating_setting*1.45/4,fuse_rating_setting*1.45/4,
                                       fuse_rating_setting*1.45/4,0,0,0,0,0];
        log(LOG_INFO, "3/4*1.45*In cool-down test INFO: Changing simulated current to " + verification_current_vector.slice(0,4));
        setSimulatedCurrent(verification_current_vector.slice(0,4));       
        verification_sub_phase++;
        break; 
      }
      if(!def(switch_status)) || !def(loadStatus)) {
          log(LOG_ERROR, "3/4*1.45*In cool-down test ERROR: Could not obtain switch- or load status");
          stopScript(true);
          verification_phase = -1;
          break;
      }
      if (verification_sub_phase < ~~(0.8*cool_down_time/0.5)){
        if(switch_status.every(function(switch){return (switch.switch_state == "on" || !switch.shed) ? true:false})){
          log(LOG_ERROR, "3/4*1.45*In cool-down test ERROR: Unexpected early re-connection happened"
          stopScript(true);
          verification_phase = -1;
          break;
        }
        if(load_status.coolDownTime == -1) {
          log(LOG_ERROR, "3/4*1.45*In cool-down test ERROR: Cool-down was expected but not reported");
          stopScript(true);
          verification_phase = -1;
          break;
        }
      }
      if (verification_sub_phase == ~~(1.2*cool_down_time/0.5)) {
        if(!switch_status.every(function(switch){return (switch.switch_state == "on" || !switch.shed) ? true:false})){
          log(LOG_ERROR, "3/4*1.45*In cool-down test ERROR: Re-connection did not happen in time");
          stopScript(true);
          verification_phase = -1;
          break;          
        }
        else {
          log(LOG_INFO, "3/4*1.45*In cool-down test SUCCESS: Re-connection happened in time");
          current = undefined;
          load_status = undefined;
          switch_state = undefined;
          verification_phase++; 
          verification_sub_phase = 0;
          break;          
        }
      }
      verification_sub_phase++
      break;

    default:
      break;
  }

//TC-7: Subsequent overloads @ load: 1.45*In
    case 7:
      waitTimer(0, 1);
      getSwitchStatus(switch_status);
      getLoadStatus(load_status);
      if (verification_sub_phase == 0) {
        log(LOG_INFO, "============= Running subsequent overloads @ Load: 1.45*In =============");
        verification_current_vector = [fuse_rating_setting*1.45/4,fuse_rating_setting*1.45/4,
                                       fuse_rating_setting*1.45/4,fuse_rating_setting*1.45/4,0,0,0,0];
        log(LOG_INFO, "1.45*In subsequent non shedding over-load test INFO: Changing simulated current to 1.45*In over-load " + verification_current_vector.slice(0,4));
        setSimulatedCurrent(verification_current_vector.slice(0,4));
      }
      if (verification_sub_phase == 1) {
        verification_current_vector = [fuse_rating_setting*1.45/4,fuse_rating_setting*1.45/4,
                                       fuse_rating_setting*1.45/4,0,0,0,0,0];
        log(LOG_INFO, "1.45*In subsequent non shedding over-load test INFO: Changing simulated current to 3/4*1.45*In under-load " + verification_current_vector.slice(0,4));
        setSimulatedCurrent(verification_current_vector.slice(0,4));
      }
      if (verification_sub_phase == 2) {
        verification_current_vector = [fuse_rating_setting*1.45/4,fuse_rating_setting*1.45/4,
                                       fuse_rating_setting*1.45/4,fuse_rating_setting*1.45/4,0,0,0,0];
        log(LOG_INFO, "1.45*In subsequent non shedding over-load test INFO: Again, changing simulated current to 1.45*In over-load " + verification_current_vector.slice(0,4));
        setSimulatedCurrent(verification_current_vector.slice(0,4));
      }
      if (verification_sub_phase == 3) {
        let found_first_sheddable = false;
        let correct_shedding = true;
        for(let i=0; < switch_status.length; i++) {
          if(found_first_sheddable) {
            if(switch_status.shed && switch_status.switch_state == "off")
              correct_shedding = false;
          }
          else if(switch_status.shed) {
            found_first_sheddable = true;
            if(switch_status.switch_state == "on")
              correct_shedding = false;
          }
        }
        if(!correct_shedding){
          log(LOG_ERROR, "1.45*In subsequent non shedding over-load test ERROR: Shedding did not happen after repeated over-loads");
          stopScript(true);
          verification_phase = -1;
          break;
        } 
        else {
         log(LOG_INFO, "1.45*In subsequent non shedding over-load test SUCCESS: Correct shedding happened after repeated over-loads");
         current = undefined;
         load_status = undefined;
         switch_state = undefined;
         verification_phase++; 
         verification_sub_phase = 0;
         break; 
      }
      verification_sub_phase++
      break;
      
    default:
      break;
  }
}

/*********************************************************************************************************/
/*                                              main/init                                                */
/*********************************************************************************************************/

Timer.set(100, true, verificationEngine);
Shelly.addEventHandler(shellyEventCb); 
Timer.set(scan_interval * 1000, true, scanPower);
if(cicd_verification_setting) {
  Timer.set(100, true, verificationEngine);
}
