/*********************************************************************************************************
 * @title: General shelly load shedding script
 * @(C): Jonas Bjurel et Al.
 * @License: Apache 2 
 * @description:
 * The purpose of this Shedder script is to provide means to control current drawing through group fuses,
 * grid termination points, etc., such that unnecessary fuse shedding happens or excessive grid cost is 
 * charged for due to high current draw, and even control the power draw at forcasted high cost periods.
 * A detailed description can be found here: https://github.com/jonasbjurel/shellyShedder/blob/main/README.md
 **********************************************************************************************************/


/***********************************************  Todo:   ************************************************
 * 1) Rebase variable names
 * 2) Priority override handling
 *
**********************************************************************************************************/




/********************************************    Constants ***********************************************/
const LOG_PREFIX = "shedder"
const LOG_VERBOSE = 0;
const LOG_INFO = 1;
const LOG_WARN = 2;
const LOG_ERROR = 3;
const LOG_CRITICAL = 4;
const CALL_LIMIT = 5;
/*********************************************************************************************************/




/****************************   Default settings, can be changed with caution    *************************/
/*************************  But can also be permanently changed with KVS webhooks   **********************/
let hostname_setting = "";
let fuse_rating_setting = 16;
let fuse_char_setting = "C";
let margin_factor_setting = 4;
let cool_down_time_setting = 10;
let first_to_last_to_shed = [
  { addr: "localhost", gen: 2, type: "relay", id: 3, shed: true, measure: true },
  { addr: "localhost", gen: 2, type: "relay", id: 2, shed: true, measure: true },
  { addr: "localhost", gen: 2, type: "relay", id: 1, shed: true, measure: true },
  { addr: "localhost", gen: 2, type: "relay", id: 0, shed: false, measure: true },
];
let time_to_test_loading_setting = 60;
let scan_interval = 0.5;
let simulation = false;
let turn_relay_on_simulation = false;
let simulated_current = new Array(first_to_last_to_shed.length);
for (let i = 0; i < first_to_last_to_shed.length; i++) simulated_current[i] = 0;
let current_restriction_setting = -1;
let current_restriction_hysteresis_setting = 0.1;
let overload_webhook_uri_setting = "";
let log_level_setting = LOG_INFO;
/*********************************************************************************************************/




/***********************************  Program variables, do not change   *********************************/
let fuse_load_trip_time_table = [	
  {over_current: 1.13, trip_time: -1},
  {over_current: 1.3, trip_time: 90},
  {over_current: 1.5, trip_time: 20},
  {over_current: 2, trip_time: 6},
  {over_current: 3, trip_time: 2},
  {over_current: 5, trip_time: 0.8}, 
  {over_current: 10, trip_time: 0.3},
];
let fuse_short_trip_current_table = [
  {fuse_char: "B", over_current: 2},
  {fuse_char: "C", over_current: 4},
  {fuse_char: "D", over_current: 9},
  {fuse_char: "Z", over_current: 1},
  {fuse_char: "K", over_current: 8},
];
let switch_state = new Array(first_to_last_to_shed.length);
for (let i = 0; i < first_to_last_to_shed.length; i++) switch_state[i] = true;
let idx_next_to_toggle_off = 0;
let direction = "coasting";
let last_known_current = new Array(first_to_last_to_shed.length);
for (let i = 0; i < first_to_last_to_shed.length; i++) last_known_current[i] = 0;
let min_trip_time = -1;
let over_load_time = -1;
let cool_down_time_remaining = -1;
let time_to_test_loading = -1;
let cool_logging = false;
let shelly_call_records = [];
let running = false;
let overrun_cnt = 0;
let consecutive_overrun_cnt = 0;
let last_overrun = false;
let coasting_report_cnt = 0;
let total = 0;
let current_scan_time = 0;
let calls = 0;
let last_kvs_rev = -1; 
let current_vector = new Array(first_to_last_to_shed.length);
let delete_KVS_cnt = 0;
let measurement_ongoing = false;
let remaining_measurements = 0;
let measurement_session_id = 0;
let measurement_timeout = 5;
let measurement_timer = undefined;
let measurement_busy_cnt = 0;
let measurement_fail_cnt = 0;
let measurement_timeout_cnt = 0;
let script_start_time = 0;
let metrics_updated = false;
let cpu_load_perc = 0;
let mem_used = 0;
let mem_used_perc = 0;
let mem_free = 0;
let mem_free_perc = 0;
let mem_high_watermark = 0;
let mem_high_watermark_perc = 0;
let total_mem = 0;

/*********************************************************************************************************/




/*********************************************************************************************************/
/*                                          Platform functions                                           */
/*********************************************************************************************************/

/* function def(o);
 * Check if defined */
function def(o) {
  return typeof o !== "undefined";
}

/* function reboot()
 * Reboots the Shelly */
function reboot() {
  Shelly.Reboot();
}

function restart() {
  Shelly.call('Script.Stop', {id: Shelly.getCurrentScriptId()});                                      //The watchdog will restart the script
}

function factoryReset() {
  deleteAllKVS(function(){restart()});
}

function parseQuery(queryString) {
  let params = {};
  if (!queryString) 
	return params;
  let pairs = queryString.split("&");
  for (let i = 0; i < pairs.length; i++) {
    let pair = pairs[i].split("=");
    if (pair.length === 2)
      params[pair[0]] = pair[1];
    else if (pair.length === 1)
      params[pair[0]] = undefined;
  }
  return params;
}

function shedderEndPoint(req, res) {
  let key_values = parseQuery(req.query);
  switch(Object.keys(key_values)[0]) {
    case "factory_reset_to_default":
      log(LOG_WARN, "Factory reset to default ordered, will delete all KVS entries related to this script and restart the script");
      factoryReset();
      res.body = "Factory reset to default ordered, will delete all KVS entries related to this script and restart the script";
      res.code = 200;     
      break;
      
    case "restart":
      log(LOG_WARN, "Restart of script ordered - will restart the script");
      restart();
      res.body = "Restart of script ordered - will restart the script";
      res.code = 200;     
      break;      
           
    case "simulation":
      if(key_values.simulation === "true") {
		if (!def(key_values.turnRelayOnSimulation) || key_values.turnRelayOnSimulation === "false") {
		  simulation = true;
		  turn_relay_on_simulation = false;
		  log(LOG_INFO, "Simulation started - relays will not be turned");
		  res.body = JSON.stringify({simulation: true, turnRelayOnSimulation: false});
		  res.code = 200;
		}
		else if (key_values.turnRelayOnSimulation === "true") {
		  simulation = true;
		  turn_relay_on_simulation = true;
          log(LOG_INFO, "Simulation started - relays will be turned");
		  res.body = JSON.stringify({simulation: true, turnRelayOnSimulation: true});
		  res.code = 200;
		}
		else {
          log(LOG_INFO, "turnRelayOnSimulation=" + key_values.turnRelayOnSimulation + " is not recognized as a valid value");
          res.body = "turnRelayOnSimulation=" + key_values.turnRelayOnSimulation + " is not recognized as a valid value";
		  res.code = 405;	
		}
      }
      else if(key_values.simulation === "false") {
        simulation = false;
		turn_relay_on_simulation = false;
        log(LOG_INFO, "Simulation stopped");
        res.body = JSON.stringify({simulation: false, turnRelayOnSimulation: false});
        res.code = 200;
      }
      else {
        log(LOG_WARN, "Received a HTTP query for simulation with a wrong value: " +
                       key_values[0].simulation);
        res.body = "Received a HTTP query for simulation with a wrong value: " +
                    key_values[0].simulation;
        res.code = 405;
      }
      break;

    case "setSimulatedCurrent":
      let ordered_simulation_current_str = key_values.setSimulatedCurrent.split(",");
      ordered_simulation_current_str[0] = ordered_simulation_current_str[0].split("[")[1];
      ordered_simulation_current_str[ordered_simulation_current_str.length-1] =
        ordered_simulation_current_str[ordered_simulation_current_str.length-1].split("]")[0];
      if(ordered_simulation_current_str.length != simulated_current.length) {
        log(LOG_WARN, "Received a HTTP query for setting simulation current with a size that doesnt " +
                   "match the number of current sensors");
        res.body = "Received a HTTP query for setting simulation current with a size that doesnt " +
                   "match the number of current sensors";
        res.code = 400;
        break;
      }
      let ordered_simulation_current = new Array(ordered_simulation_current_str.length);
      try {
        ordered_simulation_current = ordered_simulation_current_str.map(Number);
      }
      catch (error) {
        log(LOG_WARN, error);
        res.body = error;
        res.code = 400;
        break;
      }
      if(ordered_simulation_current.some(isNaN)) {
        log(LOG_WARN, "Received a HTTP query for setting simulation current which did not consist " +
                   "of all numbers");
        res.body = "Received a HTTP query for setting simulation current which did not consist " +
                   "of all numbers";
        res.code = 400;
        break;
      }
      log(LOG_INFO, "Simulation current changed: " + simulated_current + "=>" +
                    ordered_simulation_current);
      res.body = "Simulation current changed: " + simulated_current + "=>" +
                 ordered_simulation_current;
      res.code = 200;
      simulated_current = ordered_simulation_current;
      break;
      
    case "measurePerformanceMetrics":
      queueShellyCall("Script.GetStatus", {id: Shelly.getCurrentScriptId()}, 
        function (result) {
          if (result) {
            metrics_updated = true;
            cpu_load_perc = result.cpu;
            mem_used = result.mem_used;
            mem_used_perc = (result.mem_used/(result.mem_used + result.mem_free) * 100).toFixed(0);
            mem_free = result.mem_free;
            mem_free_perc = (result.mem_free/(result.mem_used + result.mem_free) * 100).toFixed(0);
            mem_high_watermark = result.mem_peak;
            mem_high_watermark_perc = (result.mem_peak/(result.mem_used + result.mem_free) * 100).toFixed(0);
            total_mem = (result.mem_used) + result.mem_free;
          }
          else {
            log(LOG_WARN, "No script status available");
          }
        }
      );
      res.body = "use getPerformanceMetricMeasurements to get the readings";   
      res.code = 200;
      break;
    
    case "getPerformanceMetricMeasurements":
      res.body = JSON.stringify({performanceMetrics: {metricsUpdated: metrics_updated,
                                 upTime: Math.floor(Date.now()/1000)-script_start_time,
                                 cpuLoadPerc:cpu_load_perc, memUsed:mem_used,
                                 memUsedPerc:mem_used_perc, memFree:mem_free,
                                 memFreePerc:mem_free_perc, memHighWatermark:mem_high_watermark,
                                 memHighWatermarkPerc:mem_high_watermark_perc,
                                 totalMem: total_mem, overRuns:overrun_cnt,
                                 measurementBusyCnt: measurement_busy_cnt,
                                 measurementFailCnt: measurement_fail_cnt,
                                 measurementTimeoutCnt: measurement_timeout_cnt}});
      metrics_updated = false;
      res.code = 200;
      break;
 
    case "getCurrent":
      res.body = JSON.stringify({current:{total: total, channels:current_vector}});
      res.code = 200;
      break;
      
    case "setCurrentRestriction":
      let ordered_set_current_restriction = JSON.parse(key_values.setCurrentRestriction);
      if (typeof(ordered_set_current_restriction) != "number") {
        log(LOG_WARN, "Received setCurrentRestriction: " + ordered_set_current_restriction + " is not a number");
        res.body = "Received setCurrentRestriction: " + ordered_set_current_restriction + " is not a number";
        res.code = 400;
        break;
      }
      else {
        current_restriction_setting = ordered_set_current_restriction;
        log(LOG_INFO, "Setting current_restriction_setting to: " + current_restriction_setting);
        res.body = "Setting current_restriction_setting to: " + current_restriction_setting;
        res.code = 200;
        break;
      }
      
    case "getLoadStatus":
      res.body = JSON.stringify({loadDirection:direction ,
                                  overLoadTime:over_load_time, coolDownTimeRemaining:cool_down_time_remaining,
                                  lastKnownCurrent:last_known_current,
                                  currentRestriction:current_restriction_setting});
      res.code = 200;
      break;
      
    case "getTripTime":
      if (def(trip_current)) {
        let trip_current = Number(key_values.getTripTime);
        res.body = JSON.stringify({tripData:{current:trip_current, tripTime:getTripTime(trip_current),
                                  shedMarginFactor:margin_factor_setting}});
        res.code = 200;
      }
      else
        res.code = 400       
      break;
      
    case "getSwitchStatus":
      let switchStatus = new Array(first_to_last_to_shed.length);
      let prio = 0;
      for (let i = 0; i < first_to_last_to_shed.length; i++)
        if(first_to_last_to_shed[i].shed) prio++;
      for (let i = 0; i < switchStatus.length; i++) {
        switchStatus[i] = first_to_last_to_shed[i];
        switchStatus[i].switch_state = switch_state[switchStatus[i].id] == true ? "on" : "off";
        if(first_to_last_to_shed[i].shed) {
          switchStatus[i].priority = prio-1;
          prio--;
        }
        else
          switchStatus[i].priority = -1;
      }
      res.body = JSON.stringify({switchStatus: switchStatus});
      res.code = 200;
      break;
    default:
      res.code = 404;
      res.body = "Unknown command";
	  log(LOG_WARN, "Unknown command");
  	  break;
  }
  res.send();  
}

/* function log(severity, log_entry);
 * Log entries to console according to "log_level_setting" which can be any of
 * LOG_VERBOSE, LOG_INFO, LOG_WARN, LOG_ERROR and LOG_CRITICAL */
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
                      //print(call_record.meth);
                      //print(call_record.meth_param);
		              //shelly_call_records.splice(0, 1);
		              if (shelly_call_records.length && calls == CALL_LIMIT-2) {
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

function checkKVS() {
  queueShellyCall("KVS.List", { match: "*"}, 
    function(result, error_code, error_message) {
      if(def(result) && result.rev != last_kvs_rev) {
	    last_kvs_rev = result.rev;
	    Shelly.emitEvent("KVS", {});
      }
    }
  );
}

/* function shellyEventCb()
 * A shelly or user defined event has been triggered */
function shellyEventCb(event) {
  switch (event.name) {
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
/*********************************************************************************************************/




/*********************************************************************************************************/
/*                                        Application functions                                          */
/*********************************************************************************************************/

/* getTripTime(current);
 * Provides the estimated trip-time in seconds for a fuse with rating and characteristics as defined
 *  by "fuse_rating_setting" and "fuse_char_setting" according to IEC 60269 */
function getTripTime(current) {
  let found = false;
  for (let i = 0; i < fuse_short_trip_current_table.length; i++) {
    if (fuse_short_trip_current_table[i].fuse_char == fuse_char_setting) {					// Performs a check against the fuse short
      found = true;																			// characteristics provided by
      if (fuse_short_trip_current_table[i].over_current < current/fuse_rating_setting) {	// by "fuse_load_trip_time_table" in
        return 0;
      }
    }
  }
  if (!found) return -1;
  for (let i=0; i<fuse_load_trip_time_table.length; i++) {									// Performs a linear interpolation in-between 
    if (current / fuse_rating_setting < fuse_load_trip_time_table[i].over_current) {		// The data points provided in
      if (fuse_load_trip_time_table[i].trip_time == -1)
		return -1																			// "fuse_load_trip_time_table"
      if (fuse_load_trip_time_table[i-1].trip_time == -1) 									// NEEDS FIX
        return fuse_load_trip_time_table[i].trip_time;
      let K = (fuse_load_trip_time_table[i].over_current - current/fuse_rating_setting)/
              (fuse_load_trip_time_table[i].over_current-fuse_load_trip_time_table[i-1].over_current);
      let segment_add = K*(fuse_load_trip_time_table[i-1].trip_time - 
                           fuse_load_trip_time_table[i].trip_time);
      let trip_time = fuse_load_trip_time_table[i].trip_time + segment_add;
      return trip_time;
    }
  }
  return -1
}

/* mustShed(current();
 * Checks if the next channel in priority order must be turned off in order to avoid that the group 
 * fuse trips. This function takes into account the tripping time according to the fuse rating- 
 * and characteristics as provided by getTripTime() functions and applies a safety margin defined by 
 * and applies a margin as defined by "margin_factor_setting" */
function mustShed(current) {
  if (current_restriction_setting != -1 && current > current_restriction_setting) {
    log(LOG_INFO, "The total current exceeds northbound ordered current restriction " + 
        current + " A > " + current_restriction_setting + "A");
    return true;
  }
  let current_trip_time = getTripTime(current);
  if (current_trip_time == -1) {
    min_trip_time = -1;
    over_load_time = -1;
    return false;
  }
  if (over_load_time == -1) {
    over_load_time = 0;
    min_trip_time = current_trip_time;
    log(LOG_INFO, "Fuse is overloaded at " + current + " A, it will trip in " + current_trip_time +
        " seconds, shedding will start in " + current_trip_time/margin_factor_setting  + " seconds");
  }
  else over_load_time += scan_interval * (consecutive_overrun_cnt + 1);
  if (current_trip_time < min_trip_time) {
    min_trip_time = current_trip_time;
    log(LOG_INFO, "Fuse overload escalation, now at " + current + " A, it will trip in " +
        current_trip_time + " seconds, shedding will start in " + current_trip_time/margin_factor_setting  +
        " seconds");  
  }
  if (over_load_time > min_trip_time/margin_factor_setting ||
     (min_trip_time/margin_factor_setting) - over_load_time < scan_interval * (consecutive_overrun_cnt + 1)) {
    if (idx_next_to_toggle_off != first_to_last_to_shed.length && first_to_last_to_shed[idx_next_to_toggle_off].shed)
      log(LOG_INFO, "Fuse overloaded with " + current + " A for " + over_load_time +
          " seconds, shedding will start");
    return true;
  }
  return false;
}

/* function canLoad(current);
 * Provides an indication whether the group fuse can take more load even if so little.
 * After an overload situation, the fuse is not allowed to take more load until the 
 * fuse has cooled down for "cool_down_time_setting" seconds. */
function canLoad(current) {
  if (current > fuse_rating_setting) {
    cool_down_time_remaining = cool_down_time_setting;
    return false;
  }
  if (cool_down_time_remaining != -1 && cool_down_time_remaining <= scan_interval * (consecutive_overrun_cnt + 1)) {
    log(LOG_INFO, "The fuse that was previously overloaded " + 
                  "has been cooled down for further loading");
    cool_down_time_remaining = -1;
  }
  else if (cool_down_time_remaining == cool_down_time_setting) {
    log(LOG_INFO, "The fuse that was previously overloaded, is now at " + current + 
                  " A, but needs to cool down for " + cool_down_time_remaining +
                  " seconds before any further loading is allowed");
    cool_down_time_remaining -= scan_interval * (consecutive_overrun_cnt + 1);
  }
  else if (cool_down_time_remaining != -1)
    cool_down_time_remaining -= scan_interval * (consecutive_overrun_cnt + 1);
  if (cool_down_time_remaining != -1)
    return false;
  if (current_restriction_setting != -1 && current > current_restriction_setting)
    return false;
  return true;
}

/* function get_current(cb , params);
 * Provides the aggregated current through the group fuse to be protected, I.e. the sum of the 
 * current through all channels. If in simulation mode, the current is the aggregate of the
 * "simulated_current[]" array elements. */
function get_current(cb, params) {
  if (measurement_ongoing) {
	measurement_busy_cnt++;
	log(LOG_WARN, "Current measurement service is busy, busy count: " + measurement_busy_cnt);
	return -1;
  }
  measurement_timer = Timer.set( measurement_timeout * 1000, false, getCurrentTimeout);
  measurement_ongoing = true;
  remaining_measurements = first_to_last_to_shed.length;
  measurement_session_id++;
  if (simulation) {
    for (let i = 0; i < first_to_last_to_shed.length; i++) {
      if (switch_state[first_to_last_to_shed.length-1-i] && first_to_last_to_shed[i].measure) {
		get_current_immediate_cb(Number(simulated_current[first_to_last_to_shed.length-1-i]), 0, "", {idx: i, sessionId: measurement_session_id, cb: cb, params: params});
      }
      else {
		get_current_immediate_cb(Number(0), 0, "", {idx: i, sessionId: measurement_session_id, cb: cb, params: params});
      }
    }
    return 0
  }
  else { 																					// No simulation of current
    for (let i=0; i < first_to_last_to_shed.length; i++) {
      if (first_to_last_to_shed[i].addr == "localhost") {
		  if (first_to_last_to_shed[i].measure)
		    get_current_immediate_cb(Shelly.getComponentStatus("switch:" + first_to_last_to_shed[i].id).current, 0, "", {idx: i, sessionId: measurement_session_id, cb: cb, params: params});
		  else
		    get_current_immediate_cb(0, 0, "", {idx: i, sessionId: measurement_session_id, cb: cb, params: params});
	  }
      else {																			// Remote host asynchronous measurement
		if (first_to_last_to_shed[i].measure)
		  queueShellyCall("HTTP.GET", {url: "http://" + first_to_last_to_shed[i].addr + "/rpc/Shelly.GetStatus?switch:" + i},
		    get_current_immediate_cb, {idx: i, sessionId: measurement_session_id, cb: cb, params: params});
		else
		  get_current_immediate_cb(0, 0, "", {idx: i, sessionId: measurement_session_id, cb: cb, params: params}); 
	  }
    }
  }
  return 0;
}

function get_current_immediate_cb(chanel_current, error, error_msg, params) {
  if ((def(error) && error) || !def(chanel_current)) {
	measurement_ongoing = false;
	log(LOG_ERROR, "Current measurement failed for idx: " + params.idx);
	measurement_fail_cnt++;
	return;
  }
  if (params.sessionId != measurement_session_id) {
    log(LOG_WARN, "mismatching session ID: " + params.session_id);
	return;
  }
  if (!measurement_ongoing) {
	return;
  }
  remaining_measurements--;
  current_vector[first_to_last_to_shed.length-1-params.idx] = chanel_current;
  if (switch_state[first_to_last_to_shed.length-1-params.idx])
	last_known_current[first_to_last_to_shed.length-1-params.idx] = chanel_current;
  if (!remaining_measurements) {
	Timer.clear(measurement_timer);
	measurement_ongoing = false;
	let sum = 0;
	for(let i=0; i<current_vector.length; i++) 
	  sum += current_vector[i];
	params.cb(sum, 0, "", params);
  }
}

function getCurrentTimeout() {
	measurement_timeout_cnt++;
	log(LOG_ERROR, "Current measurement time-out, timeout count: " + measurement_timeout_cnt);
    measurement_ongoing = false;
}
	
/* function turn()
 * Turns the relay first_to_last_to_shed[idx] on or off */
function turn(idx, dir) {
  log(LOG_INFO, "Turning switch " + first_to_last_to_shed[idx].id + " to " + dir);
  let on = dir == "on" ? true : false;
  switch_state[first_to_last_to_shed[idx].id] = on;
  if (simulation && !turn_relay_on_simulation)
	return;
  if (def(first_to_last_to_shed[idx].on_url) && def(first_to_last_to_shed[idx].off_url)) {
    if (def(first_to_last_to_shed[idx].on_url) && dir == "on")
      queueShellyCall("HTTP.GET", { url: first_to_last_to_shed[idx].on_url }, turnCallBack, {idx});
    if (def(first_to_last_to_shed[idx].off_url) && dir == "off")
      queueShellyCall("HTTP.GET", { url: first_to_last_to_shed[idx].off_url }, turnCallBack, {idx});
	return;
  }
  if (first_to_last_to_shed[idx].addr === "localhost") {
	queueShellyCall("Switch.Set", {on:on, id:first_to_last_to_shed[idx].id}, turnCallBack, idx);
	return;
  }
  if (def(first_to_last_to_shed[idx].gen)) {
    let cmd;
    if (first_to_last_to_shed[idx].gen == 1) 
	  cmd = first_to_last_to_shed[idx].type + "/" + first_to_last_to_shed[idx].id.toString() + "?turn=" + dir;
    else
	  cmd = "rpc/" + first_to_last_to_shed[idx].type + ".Set?id=" + first_to_last_to_shed[idx].id.toString() + "&on=" + on;
    queueShellyCall("HTTP.GET", { url: "http://" + first_to_last_to_shed[idx].addr + "/" + cmd }, turnCallBack, {idx});
	return;
  }
  log(LOG_ERROR, "Failed to operate relay - first_to_last_to_shed id: " + idx + " - configuration error");
}

/* function turnCallBack()
 * Callback function from turn() */
function turnCallBack(result, error_code, error_message, idx) {
  if (error_code != 0)
    log(LOG_ERROR, "Failed to operate relay - first_to_last_to_shed id:  " + idx + " - Error: " + error_message);
  else
    log(LOG_INFO, "Relay - first_to_last_to_shed id: " + idx + " operated successfully");
}

/* function updateSettingsFromKVS();
 * This functions sets the script variables from the Shelly Key-Value store which can be user set. */
function updateSettingsFromKVS() {
  queueShellyCall("KVS.GetMany", {},
    function (result, error_code, error_message) {
      for (let KVS in result.items) {
        switch (result.items[KVS].key) {

          case "hostname_setting":
            if (hostname_setting != result.items[KVS].value) {
              hostname_setting = result.items[KVS].value;
              log(LOG_INFO, "Hostname is set to: " + result.items[KVS].value);
            }
            break;

          case "fuse_rating_setting":
            if (fuse_rating_setting != result.items[KVS].value) {
              fuse_rating_setting = result.items[KVS].value;
              log(LOG_INFO, "Fuse rating changed to: " + result.items[KVS].value);
            }
            break;

          case "fuse_char_setting":
            if (fuse_char_setting != result.items[KVS].value) {
              fuse_char_setting = result.items[KVS].value;
              log(LOG_INFO, "Fuse characteristics changed to: " + result.items[KVS].value);
            }
            break;

          case "margin_factor_setting":
            if (margin_factor_setting != result.items[KVS].value) {
              margin_factor_setting = result.items[KVS].value;
              log(LOG_INFO, "Fuse trip margin factor changed to: " + result.items[KVS].value);
            }
            break;

          case "cool_down_time_setting":
            if (cool_down_time_setting != result.items[KVS].value) {
              cool_down_time_setting = result.items[KVS].value;
              log(LOG_INFO, "Fuse cool down time before re-loading changed to: " +
                  result.items[KVS].value);
            }
            break;

        case "time_to_test_loading_setting":
            if (time_to_test_loading_setting != result.items[KVS].value) {
              time_to_test_loading_setting = result.items[KVS].value;
              log(LOG_INFO, "Time to test increased loading despite no margins changed to: " +
                  result.items[KVS].value);
            }
            break;

          case "scan_interval":
             if (scan_interval != result.items[KVS].value) {
               scan_interval = result.items[KVS].value;
               log(LOG_INFO, "Scan interval changed to: " + result.items[KVS].value);
             }
             break;

          case "current_restriction_hysteresis_setting":
            if (current_restriction_hysteresis_setting != result.items[KVS].value) {
              current_restriction_hysteresis_setting = result.items[KVS].value;
              log(LOG_INFO, "Current restriction hysteresis changed to : " + result.items[KVS].value);
            }
            break;

          case "overload_webhook_uri_setting":
            if (overload_webhook_uri_setting != result.items[KVS].value) {
              overload_webhook_uri_setting = result.items[KVS].value;
              log(LOG_INFO, "Overload Webhook URI set to  " + result.items[KVS].value);
            }
            break;            
 
          case "log_level_setting":
            if (log_level_setting!= result.items[KVS].value) {
              log_level_setting = result.items[KVS].value;
              log(LOG_INFO, "Log level changed to: " + result.items[KVS].value);
            }
            break;

          case "shed_chan_ptr":
            let shed_chan_ptr = JSON.parse(result.items[KVS].value);
            for (let i=0; i<shed_chan_ptr.length; i++) {
              Shelly.call("KVS.Get", {key: shed_chan_ptr[i]},
                function (res, err, err_str, i) {
                  if(def(res) && def(res.value) && res.value != JSON.stringify(first_to_last_to_shed[i]))
                    first_to_last_to_shed[i] = JSON.parse(res.value);
                },
				i
              );
            }
            break;
                
          default:
            break;
        }
      }
      return; 
    }
  );
}


//FIX - refactoring update and delete KVS handling to be more uniform
/* function createKV(k, v, over_write);
 * Creates Key-value store entries from the script defined setting defaults, if "over_write" is 
 * set to true it will over-write an already existing key-value, otherwise not */
function createKV(k, v, over_write) {
  queueShellyCall("KVS.Get", {key:k}, 
    function (result, error_code, error_message) {
       if(!def(result) || over_write) {
         queueShellyCall("KVS.Set", {key:k, value:v}, 
           function(result, error_code, error_message) {
             return;  
           }
         );
       }
    }
  );
}

/* function deleteKV(k);
 * Deletes Key-value store entries */
function deleteKV(keys, cb, params) {
  if (delete_KVS_cnt) return -1;
  for(let i=0; i<keys.length; i++) {
    delete_KVS_cnt++;
    queueShellyCall("KVS.Delete", {key:keys[i]},
                    function(result, error_code, error_message, params) {
                      delete_KVS_cnt--;
                      if(!delete_KVS_cnt && def(params.cb))
                        params.cb(params.params);
                    },
                    {cb:cb, params:params}
                    );
  }
}

/* function deleteKvs()
 * Deletes Key-Value store from script settings */
function deleteAllKVS(cb, params) {
  log(LOG_INFO, "Deleting KVS entries used for the ShellyShedding script, when the ShellyShedding" +
                "script restarts it will populate the KVS store with factory default settings");
  let delete_items = ["hostname_setting", "fuse_rating_setting", "fuse_char_setting", "margin_factor_setting",
                      "cool_down_time_setting", "first_to_last_to_shed", "time_to_test_loading_setting",
                      "scan_interval", "current_restriction_hysteresis_setting", "overload_webhook_uri_setting",
                      "log_level_setting"];
  Shelly.call("KVS.Get", {key: "shed_chan_ptr"},
    function(res, err, err_str, params) {

      let all_delete_items = params.delete_items;
      if (def(res) && def(res.value)){
        all_delete_items.push("shed_chan_ptr");
        let value = JSON.parse(res.value);
        for (let i=0; i<value.length; i++)
          all_delete_items.push(value[i]);
      }
      deleteKV(all_delete_items, params.cb, params.params);
    },
    {cb:cb, params:params, delete_items:delete_items}
  );
}

/* function updateKvs()
 * Creates and update the Key-Value store from default settings */
function updateKvs() {
  log(LOG_INFO, "Creating KVS entries and setting them to default if not exist, " +
      "if exist - updating script settings to default");
  createKV("hostname_setting", hostname_setting, false);
  createKV("fuse_rating_setting", fuse_rating_setting, false);
  createKV("fuse_char_setting", fuse_char_setting, false);
  createKV("margin_factor_setting", margin_factor_setting, false);
  createKV("cool_down_time_setting", cool_down_time_setting, false);
  createKV("time_to_test_loading_setting", time_to_test_loading_setting, false);
  createKV("scan_interval", scan_interval, false);
  createKV("current_restriction_hysteresis_setting", current_restriction_hysteresis_setting, false);
  createKV("overload_webhook_uri_setting", overload_webhook_uri_setting, false);
  createKV("log_level_setting", log_level_setting, false);
  let shed_chan_ptr = [];
  for (let i=0; i<first_to_last_to_shed.length; i++) {
    createKV("shed_chan_" + i, JSON.stringify(first_to_last_to_shed[i]), false);
    shed_chan_ptr.push("shed_chan_" + i);
  }
  createKV("shed_chan_ptr", JSON.stringify(shed_chan_ptr), false);
}

function nextIdxToLoad(idx_next_to_toggle_off) {
  while (idx_next_to_toggle_off > 0) {
    idx_next_to_toggle_off--;
    if (first_to_last_to_shed[idx_next_to_toggle_off].shed) {
	  return idx_next_to_toggle_off;
      break;
	}
  }
  return null;
}

function nextIdxToShed(idx_next_to_toggle_off) {
  while (idx_next_to_toggle_off < first_to_last_to_shed.length - 1) {
    idx_next_to_toggle_off++;
    if (first_to_last_to_shed[idx_next_to_toggle_off].shed) {
      return idx_next_to_toggle_off;
      break;
	}
  }
  return null;
} 

/* function scanCurrent()
 * Main scan loop, gets invoked every "scan_interval" seconds. */
function scanCurrent() {
  current_scan_time  += scan_interval;
  if (!(current_scan_time % 10)) 
    checkKVS();
  if (!last_overrun)
	consecutive_overrun_cnt = 0;
  if (running) {
    last_overrun = true;
    overrun_cnt++;
	consecutive_overrun_cnt++;
    log(LOG_WARN, "Overrun - Overrun count is: " + overrun_cnt + " and consecutive overrun count is: " + consecutive_overrun_cnt);
    return;
  }
  running = true;
  if (get_current(processCurrentMeasurements)) {
    last_overrun = true;
    overrun_cnt++;
	consecutive_overrun_cnt++;
    log(LOG_ERROR, "Measure failure - did not expect this - Overrun count is: " + overrun_cnt + " and consecutive overrun count is: " + consecutive_overrun_cnt);
	running = false;
	return;
  }
}

function processCurrentMeasurements(current, err_code, err_msg) {
  if (def(err_code) && err_code) {
    last_overrun = true;
    overrun_cnt++;
    consecutive_overrun_cnt++;
    running = false;
    log(LOG_ERROR, "Measure failure - " + err_msg);
  }
  last_overrun = false;
  total = current;
  let must_shed = mustShed(total);
  let can_load = canLoad(total);
  if (idx_next_to_toggle_off < first_to_last_to_shed.length && must_shed) {
    direction = "shedding";
    time_to_test_loading = time_to_test_loading_setting;
  }
  else if ((current_restriction_setting == -1 && nextIdxToLoad(idx_next_to_toggle_off) != null && can_load && total + 
           last_known_current[first_to_last_to_shed.length-1-nextIdxToLoad(idx_next_to_toggle_off)] <= fuse_rating_setting) ||
           (current_restriction_setting != -1 && nextIdxToLoad(idx_next_to_toggle_off) != null && can_load && total + 
           last_known_current[first_to_last_to_shed.length-1-nextIdxToLoad(idx_next_to_toggle_off)] <= fuse_rating_setting && total +
           last_known_current[first_to_last_to_shed.length-1-nextIdxToLoad(idx_next_to_toggle_off)]  <= current_restriction_setting *
           (1-current_restriction_hysteresis_setting))) {
    direction = "loading";
	time_to_test_loading = time_to_test_loading_setting;
  }
  else {
    direction = "coasting";
    if (time_to_test_loading != -1 && time_to_test_loading - scan_interval * (consecutive_overrun_cnt + 1) < 0) {
      time_to_test_loading = -1;
      if (nextIdxToLoad(idx_next_to_toggle_off) != null) {
        for(let i=first_to_last_to_shed.length-1-nextIdxToLoad(idx_next_to_toggle_off); i<first_to_last_to_shed.length; i++)
          last_known_current[i] = 0;
        log(LOG_INFO, "Will test load despite that the last known load does not fit the load budget");
      }
    }
    else if (time_to_test_loading != -1)
      time_to_test_loading -= scan_interval * (consecutive_overrun_cnt + 1);
  }  
  if (direction == "loading") {
    coasting_report_cnt = 0;
	let idx_next_to_toggle_off_tmp = nextIdxToLoad(idx_next_to_toggle_off);
    if (idx_next_to_toggle_off_tmp != null) {
	  idx_next_to_toggle_off = idx_next_to_toggle_off_tmp;
      if (overload_webhook_uri_setting != "" && hostname_setting != "") {
        queueShellyCall("HTTP.POST", { url: overload_webhook_uri_setting, body: 
                        {hostname: hostname_setting, state: "Loading",
	   				     fuseRating: fuse_rating_setting,
						 fuseCharacteristics: fuse_char_setting,
						 fuseCurrent: total,
						 currentRestriction: (current_restriction_setting == -1 ? false:true),
						 noOfSheddedChanels: idx_next_to_toggle_off,
						 disconnected: null,
						 reconnected: {idx: idx_next_to_toggle_off, 
									   deviceAddr: first_to_last_to_shed[idx_next_to_toggle_off].addr,
									   deviceRelayId: first_to_last_to_shed[idx_next_to_toggle_off].id,
									   estimatedReconnectCurrent:last_known_current[first_to_last_to_shed.length-1-idx_next_to_toggle_off]},
			  			 nextToDisconnect: (idx_next_to_toggle_off != first_to_last_to_shed.length ? {idx: nextIdxToShed(idx_next_to_toggle_off), 
									        deviceAddr: first_to_last_to_shed[idx_next_to_toggle_off].addr,
										    deviceRelayId: first_to_last_to_shed[idx_next_to_toggle_off].id} : null ),
						 nextToReconnect: (nextIdxToLoad(idx_next_to_toggle_off) != undefined ? {idx: nextIdxToLoad(idx_next_to_toggle_off), 
						 		    	   deviceAddr: first_to_last_to_shed[nextIdxToLoad(idx_next_to_toggle_off)].addr,
										   deviceRelayId: first_to_last_to_shed[nextIdxToLoad(idx_next_to_toggle_off)].id} : null}},
						 function(result, error_code, error_message, params) {
			  			   if (def(error_code) && error_code)
							 log(LOG_WARN, "Failed to send loading WEB-hook to endpoint: " + params.uri + " - " + error_message);
			  			     return;
            			 },
		   				 {uri: overload_webhook_uri_setting}
		   				 );
	  }
      log(LOG_INFO, "Loading global idx channel: " + idx_next_to_toggle_off + " with local relay id: " + first_to_last_to_shed[idx_next_to_toggle_off].id + ", current before loading is: " +
                     total +" A, expected current after loading is: " + 
                     (total + last_known_current[first_to_last_to_shed[idx_next_to_toggle_off].id]) + " A");
      turn(idx_next_to_toggle_off, "on");
    }
    else
      log(LOG_INFO, "No more channels to load");
  }
  if (direction == "shedding") {
    coasting_report_cnt = 0;
    if (idx_next_to_toggle_off != first_to_last_to_shed.length) {
      if (first_to_last_to_shed[idx_next_to_toggle_off].shed) {
        if (overload_webhook_uri_setting != "" && hostname_setting != "") {
          queueShellyCall("HTTP.POST", { url: overload_webhook_uri_setting, body: 
                          {hostname: hostname_setting, state: "Shedding",
	   		  			   fuseRating: fuse_rating_setting,
						   fuseCharacteristics: fuse_char_setting,
						   fuseCurrent: total,
						   currentRestriction: (current_restriction_setting == -1 ? false:true),
						   noOfSheddedChanels: first_to_last_to_shed,
						   disconnected: (idx_next_to_toggle_off<first_to_last_to_shed.length ? {idx: idx_next_to_toggle_off, 
									      deviceAddr: first_to_last_to_shed[idx_next_to_toggle_off].addr,
										  deviceRelayId: first_to_last_to_shed[idx_next_to_toggle_off].id,
										  estimatedDisconnectedCurrent:last_known_current[first_to_last_to_shed.length-1-idx_next_to_toggle_off]} : null ),
						   reconnected: null,
			  			   nextToDisconnect: (idx_next_to_toggle_off != first_to_last_to_shed.length ? {idx: idx_next_to_toggle_off, 
									          deviceAddr: first_to_last_to_shed[idx_next_to_toggle_off].addr,
										      deviceRelayId: first_to_last_to_shed[idx_next_to_toggle_off].id} : null ),
						   nextToReconnect: (nextIdxToLoad(idx_next_to_toggle_off) != null ? {idx: nextIdxToLoad(idx_next_to_toggle_off), 
						 		    	     deviceAddr: first_to_last_to_shed[nextIdxToLoad(idx_next_to_toggle_off)].addr,
										     deviceRelayId: first_to_last_to_shed[nextIdxToLoad(idx_next_to_toggle_off)].id} : null}},
						   function(result, error_code, error_message, params) {
			  			     if (def(error_code) && error_code)
							   log(LOG_WARN, "Failed to send coasting WEB-hook to endpoint: " + params.uri + " - " + error_message);
			  			     return;
            			   },
		   				   {uri: overload_webhook_uri_setting}
		   				   );
	    }
        log(LOG_INFO, "Shedding global idx channel: " + idx_next_to_toggle_off +
                      " with local relay id: " + first_to_last_to_shed[idx_next_to_toggle_off].id +
                      ", current before shedding is: " +
                      total + " A, expected current after shedding is: " +
                      (total - last_known_current[first_to_last_to_shed.length-1-idx_next_to_toggle_off]) +
                      " A , current restriction: " + (current_restriction_setting == -1 ? false:true));
        turn(idx_next_to_toggle_off, "off");
      }
      else
        log(LOG_WARN, "No more channels to shed");
	  let idx_next_to_toggle_off_tmp = nextIdxToShed(idx_next_to_toggle_off);
	  if (idx_next_to_toggle_off_tmp != null)
		idx_next_to_toggle_off = idx_next_to_toggle_off_tmp;
	  else
		idx_next_to_toggle_off = first_to_last_to_shed.length;
    }
	else
	  log(LOG_WARN, "No more channels to shed");
  }
  if (direction == "coasting") {
    if (coasting_report_cnt * scan_interval * (consecutive_overrun_cnt + 1) >= 60)
      coasting_report_cnt = 0;
    else
      coasting_report_cnt++;
    if (!coasting_report_cnt) {
	  if (overload_webhook_uri_setting != "" && hostname_setting != "") {
        queueShellyCall("HTTP.POST", { url: overload_webhook_uri_setting, body: 
                        {hostname: hostname_setting, state: "Coasting",
	   					 fuseRating: fuse_rating_setting,
						 fuseCharacteristics: fuse_char_setting,
						 fuseCurrent: total,
						 currentRestriction: (current_restriction_setting == -1 ? false:true),
						 noOfSheddedChanels: first_to_last_to_shed,
						 disconnected: null,
						 reconnected: null,
			  			 nextToDisconnect: (nextIdxToShed(idx_next_to_toggle_off-1) != undefined ? {idx: nextIdxToShed(idx_next_to_toggle_off), 
									        deviceAddr: first_to_last_to_shed[nextIdxToShed(idx_next_to_toggle_off)].addr,
										    deviceRelayId: first_to_last_to_shed[nextIdxToShed(idx_next_to_toggle_off)].id} : null ),
						 nextToReconnect: (nextIdxToLoad(idx_next_to_toggle_off) != null ? {idx: nextIdxToLoad(idx_next_to_toggle_off), 
						 		    	   deviceAddr: first_to_last_to_shed[nextIdxToLoad(idx_next_to_toggle_off)].addr,
										   deviceRelayId: first_to_last_to_shed[nextIdxToLoad(idx_next_to_toggle_off)].id} : null}},
						 function(result, error_code, error_message, params) {
			  			   if (def(error_code) && error_code)
							 log(LOG_WARN, "Failed to send coasting WEB-hook to endpoint: " + params.uri + " - " + error_message);
			  			   return;
            			 },
		   				 {uri: overload_webhook_uri_setting}
		   				 );
	  }
      log(LOG_INFO, "Coasting - Next global idx channel to shed is: " +
                    nextIdxToShed(idx_next_to_toggle_off-1) +
                    " , Next global idx channel to load is: " +
                    nextIdxToLoad(idx_next_to_toggle_off) +
                    " , Shedded channels: " + idx_next_to_toggle_off +
                    " , current: " + total + " A, current restriction: " + 
                    (current_restriction_setting == -1 ? false:true));
  	} 
  }
  running = false;
  return;
}
/*********************************************************************************************************/




/*********************************************************************************************************/
/*                                              main/init                                                */
/*********************************************************************************************************/
script_start_time = Math.floor(Date.now() / 1000)
for (let i = 0; i < first_to_last_to_shed.length; i++) turn(i, switch_state[i] ? "on" : "off");
if (!def(idx_next_to_toggle_off=nextIdxToShed(-1))) {
  log(LOG_ERROR, "Configuration error, none of the channels are sheddable");
  return;
}
updateKvs();
HTTPServer.registerEndpoint("shedder", shedderEndPoint);
Shelly.addEventHandler(shellyEventCb);
Timer.set(scan_interval * 1000, true, scanCurrent);

/*********************************************************************************************************/
