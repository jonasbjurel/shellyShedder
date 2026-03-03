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
        case "KVS":
          updateSettingsFromKVS();
          break;
       
        default:
          break;
      }
      break;
    default:
      break;
  }
}


/* function reboot()
 * Reboots the Shelly */
function reboot() {
  Shelly.Reboot();
}
/*********************************************************************************************************/


function setup(){
  KVSBackup = saveKVS();
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
            log(LOG_ERROR, "Current mesurement ERROR: Current wasnt updated in due time");
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
      verification_sub_phase++;
      break;
     
 //TC-3: Loading with maximum non tripping load: 0.13*In
    case 3:
      initStabelize();
      waitTimer(0,0.5);
      if (verification_sub_phase == 0) {
        log(LOG_INFO, "============= Running maximum non tripping load: 0.13*In =============");
        verification_current_vector = [0,0,0,0,fuse_rating_setting*1.12/4,fuse_rating_setting*1.12/4,
                                      fuse_rating_setting*1.12/4,fuse_rating_setting*1.12/4];
        log(LOG_INFO, "Load mesurement INFO: Changing simulated current to " + verification_current_vector.slice(0,4));
        setSimulatedCurrent(verification_current_vector.slice(0,4));
      }
      
      
      
      
      
      
      


      
      if (verification_sub_phase == 0)
        verification_current_vector = [0,0,0,0,fuse_rating_setting*1.12/4,fuse_rating_setting*1.12/4,
                                      fuse_rating_setting*1.12/4,fuse_rating_setting*1.12/4];
      else
        verification_current_vector.push(verification_current_vector.splice(0,1));
      log(LOG_INFO, "Changing simulated current to " + verification_current_vector.slice(0,4));
      simulated_current = verification_current_vector.slice(0,4);
      verification_phase++;
      verification_sub_sub_phase=0;
      break;
     
    case 4:
     waitTimer(0,0.5);
      if (verification_sub_sub_phase == 4) {
        if (over_load_time != -1) {
          log(LOG_ERROR, "Under-load error error, overload detected but not expected");
          queueShellyCall('Script.Stop', {id: Shelly.getCurrentScriptId()});
        }
        else
          log(LOG_INFO, "Under-load success");
        if (verification_sub_phase > 7) {
          verification_phase++;
          verification_sub_phase = 0;
          verification_sub_sub_phase = 0;
          log(LOG_INFO, "============ Starting tripping ramping load test with currents up to 1.45*In ==============");
        }
        else {
          verification_phase--;
          verification_sub_phase++;
          verification_sub_sub_phase = 0;
        }
      }
      else {
        verification_sub_sub_phase++;
      }  
      break;

    case 5:
      if (verification_sub_phase == 0)
        verification_current_vector = [0,0,0,0,fuse_rating_setting*1.45/4,fuse_rating_setting*1.45/4,
                                      fuse_rating_setting*1.45/4,fuse_rating_setting*1.45/4];
      else
        verification_current_vector.push(verification_current_vector.splice(0,1));
      log(LOG_INFO, "Changing simulated current to " + verification_current_vector.slice(0,4));
      simulated_current = verification_current_vector.slice(0,4);
      verification_phase++;        
      verification_sub_sub_phase=0;
      wait_for_shed = 0;
      break;
     
    /*case 6:
    //print("verification_sub_phase " + verification_sub_phase);
      if (verification_sub_sub_phase >= 4) {
        if (verification_sub_phase >= 4) {
          if (verification_sub_phase == 4 && over_load_time == -1) {
            log(LOG_ERROR, "Over-load error, overload not detected but should have been, current is at " +
                           (total/fuse_rating_setting) + "*In");
            queueShellyCall('Script.Stop', {id: Shelly.getCurrentScriptId()});
          }
          else if (verification_sub_phase == 4 && over_load_time != -1) {
            verification_trip_time = getTripTime(total);
            if (verification_trip_time >= 20 && verification_trip_time <= 11*60) {
              log(LOG_INFO, "Over-load success, estimated fuse trip time is " + 
                             (verification_trip_time)  +
                             " seconds is within IEC specification of 20- to " +
                             (11*60) + " seconds.");
              log(LOG_INFO, "Waiting for the lowest priority channel to shed in " + 
                            (verification_trip_time/margin_factor_setting) + " seconds." );
              wait_for_shed = current_scan_time;
            }
            else {
              log(LOG_ERROR, "Over-load error, estimated trip time: " + 
                   verification_trip_time  + " seconds is not within IEC specification of 20- and " +
                   (11*60) " seconds.");          
              queueShellyCall('Script.Stop', {id: Shelly.getCurrentScriptId()});
            }
          } 
          if (wait_for_shed) {
            if ((current_scan_time - wait_for_shed) < verification_trip_time*0.8/margin_factor_setting && !switch_state[0]) {
              log(LOG_ERROR, "Over-load error, last prio channel shedding happened early at " +
*/
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
