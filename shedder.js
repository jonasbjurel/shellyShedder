/*********************************************************************************************************
 * @title: General shelly load shedding script
 * @(C): Jonas Bjurel et Al.
 * @License: Apache 2 
 * @description:
 * The purpose of this Shedder script is to provide means to control current drawing through group fuses,
 * grid termination points, etc., such that unnecessary fuse shedding happens or excessive grid cost is 
 * charged for due to high current draw, and even control the power draw at forcasted high cost periods.
 * A detailed description can be found here: https://github.com/jonasbjurel/shellyShedder/blob/main/README.md

/***********************************************  Todo:   ************************************************
 * 1) Fix generic webhook shed handling
 * 2) Rebase variable names
 * 3) Priority override handling
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
let simulation = true;
let simulated_current = new Array(first_to_last_to_shed.length);
for (let i = 0; i < first_to_last_to_shed.length; i++) simulated_current[i] = 0;
let current_restriction_setting = -1;
let current_restriction_hysteresis_setting = 0.1;
let overload_webhook_uri_setting = "";
let log_level_setting = LOG_INFO;
let cicd_verification_setting = false;
let cicd_verification_webhook =""
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
let idx_next_to_toggle_off = 0
let direction = "coasting";
let last_known_current = new Array(first_to_last_to_shed.length);
for (let i = 0; i < first_to_last_to_shed.length; i++) last_known_current[i] = 0;
let min_trip_time = -1;
let over_load_time = -1;
let cool_down_time_remaining = -1;
let time_to_test_loading = time_to_test_loading_setting;
let cool_logging = false;
let shelly_call_records = [];
let running = false;
let overrun_cnt = 0;
let last_overrun = false;
let coasting_report_cnt = 0;
let total = 0;
let current_scan_time = 0;
let calls = 0;
let last_kvs_rev = -1; 
let current_vector = new Array(first_to_last_to_shed.length);
let delete_KVS_cnt = 0;

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
  if (!queryString) return params;
  
  // Dela upp strängen vid varje ampersand (&)
  let pairs = queryString.split("&");
  for (let i = 0; i < pairs.length; i++) {
    let pair = pairs[i].split("=");
    if (pair.length === 2) {
      // Spara som nyckel-värde (t.ex. { "power": "on" })
      params[pair[0]] = pair[1];
    }
    else if (pair.length === 1)
      params[pair[0]] = undefined;
  }
  return params;
}

function shedderEndPoint(req, res) {
  //print(JSON.stringify(req.query));
  //print(req.query);
  //print(parseQuery(req.query).key);
  //print(typeof(parseQuery(req.query).key));
  //print(parseQuery(JSON.parse(req.query).key));
  //print(JSON.parse(req.query).method);
  let key_values = parseQuery(req.query);
  //print(key_values);
  //print(Object.keys(key_values));
  //print(Object.keys(key_values)[0]);

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
        simulation = true;
        log(LOG_INFO, "Simulation started");
        res.body = "Simulation started"
        res.code = 200;
      }
      else if(key_values.simulation === "false") {
        simulation = false;
        log(LOG_INFO, "Simulation stoped");
        res.body = "Simulation stopped"
        res.code = 200;
      }
      else {
        log(LOG_WARN: "Received a HTTP query for simulation with a wrong value: " +
               key_values[0].simulation);
        res.body = "Received a HTTP query for simulation with a wrong value: " +
                   key_values[0].simulation;
        res.code = 405;
      }
      res.send();
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
        //print(ordered_simulation_current_str);
        //print(ordered_simulation_current);
      }
      catch (error) {
        log(LOG_WARN, "error");
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
      
    case "getCurrent":
      res.body = JSON.stringify({current:{total: total, channels:current_vector}});
      res.code = 200;
      break;
      
    case "setCurrentRestriction":
      let ordered_set_current_restriction = JSON.parse(key_values.setCurrentRestriction)
      if (typeof(ordered_set_current_restriction) != "number"){
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
      //print("Answered load_status request");
      res.body = JSON.stringify({loadDirection:direction ,
                                  overLoadTime:over_load_time, coolDownTimeRemaining:cool_down_time_remaining,
                                  lastKnownCurrent:last_known_current,
                                  currentRestriction:current_restriction_setting});
      res.code = 200;
      break;
      
    case "getTripTime":
      let trip_current = Number(key_values.getTripTime);
      if (def(trip_current)){
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
      for (let i = 0; i < switchStatus.length; i++){
        switchStatus[i] = first_to_last_to_shed[i];
        switchStatus[i].switch_state = switch_state[switchStatus[i].id] == true ? "on" : "off";
        if(first_to_last_to_shed[i].shed) {
          switchStatus[i].priority = prio-1;
          prio--;
        }
        else {
          switchStatus[i].prio = -1;
        }
      }
      res.body = JSON.stringify({switchStatus: switchStatus});
      res.code = 200;
      break;
    default:
      break;
  }
  res.send();
  
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
                      //print(call_record.meth);
                      //print(call_record.meth_param);
		              //shelly_call_records.splice(0, 1);
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
        log(LOG_WARN,"Short detected for switch " + i);										// accordance with IEC 60269
        return 0;
      }
    }
  }
  if (!found) return -1;
  for (let i=0; i<fuse_load_trip_time_table.length; i++) {									// Performs a linear interpolation in-between 
    if (current / fuse_rating_setting < fuse_load_trip_time_table[i].over_current) {		// The data points provided in
      if (fuse_load_trip_time_table[i].trip_time == -1) return -1							// "fuse_load_trip_time_table"
      if (fuse_load_trip_time_table[i-1].trip_time == -1) 
        return fuse_load_trip_time_table[i].trip_time;
      let K = (fuse_load_trip_time_table[i].over_current - current/fuse_rating_setting)/
              (fuse_load_trip_time_table[i].over_current-fuse_load_trip_time_table[i-1].over_current);
      let segment_add = K*(fuse_load_trip_time_table[i-1].trip_time - 
                           fuse_load_trip_time_table[i].trip_time);
      let trip_time = fuse_load_trip_time_table[i].trip_time + segment_add;
      return trip_time;
    }
  }
  return fuse_load_trip_time_table[fuse_load_trip_time_table.length].trip_time;
}


/* mustShed(current();
 * Checks if the next channel in priority order must be turned off in order to avoid that the group 
 * fuse trips. This function takes into account the tripping time according to the fuse rating- 
 * and characteristics as provided by getTripTime() functions and applies a safety margin defined by 
 * and applies a margin as defined by "margin_factor_setting" */
function mustShed(current) {
  //print("overload time: " + over_load_time );
  //print("overrun_cnt :" + overrun_cnt )
  if (current_restriction_setting != -1 && current > current_restriction_setting) {
    log(LOG_INFO, "The total curret exceeds northbound ordered current restriction " + 
        current + " A > " + current_restriction_setting + "A");
    return true;
  }
  current_trip_time = getTripTime(current);
  if (current_trip_time == -1) { 															// TODO We should probably let the fuse cool
    min_triptime_time = -1;																	// down if previously overloaded but not
    over_load_time = -1;																	// shedded
    return false;
  }
  if (over_load_time == -1) {
    over_load_time = 0;
    min_trip_time = current_trip_time;
    log(LOG_INFO, "Fuse is overloaded at " + current + " A, it will trip in " + current_trip_time +
        " seconds, shedding will start in " + current_trip_time/margin_factor_setting  + " seconds");
  }
  else over_load_time += scan_interval * (overrun_cnt + 1);
  if (current_trip_time < min_trip_time) {
    min_trip_time = current_trip_time;
    log(LOG_INFO, "Fuse overload escalation, now at " + current + " A, it will trip in " +
        current_trip_time + " seconds, shedding will start in " + current_trip_time/margin_factor_setting  +
        " seconds");  
  }
  if (over_load_time > min_trip_time/margin_factor_setting ||
     (min_trip_time/margin_factor_setting) - over_load_time < scan_interval * (overrun_cnt + 1)) {
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
  last_known_current[first_to_last_to_shed[nextIdxToLoad()].id]
  if (current_restriction_setting != -1 &&
      current_restriction_setting < (current +
      last_known_current[first_to_last_to_shed[nextIdxToLoad()].id]) *
      (1 + current_restriction_hysteresis_setting))
    return false;
  if (current > fuse_rating_setting) {
    cool_down_time_remaining = cool_down_time_setting;
    return false;
  }
  if (cool_down_time_remaining == cool_down_time_setting) {
    log(LOG_INFO, "The fuse that was previously overloaded, is now at " + current + 
                  " A, but needs to cool down for " + cool_down_time_remaining +
                  " seconds before any further loading is allowed");
  }
  if (cool_down_time_remaining <= scan_interval * (overrun_cnt + 1)) {
    if(cool_down_time_remaining != -1) {
      log(LOG_INFO, "The fuse that was previously overloaded " + 
                "has been cooled down for further loading");
    }
    cool_down_time_remaining = -1;
    return true;
  }
  cool_down_time_remaining -= scan_interval * (overrun_cnt + 1);
  return false;
}


/* function get_current();
 * Provides the aggregated current through the group fuse to be protected, I.e. the sum of the 
 * current through all channels. If in simulation mode, the current is the aggregate of the
 * "simulated_current[]" array elements. */
function get_current() {															        // TODO, must be changed to async
  //print("Simulated current: " + Number(simulated_current[0]) + "," + Number(simulated_current[1]) + "," + Number(simulated_current[2]) + "," + Number(simulated_current[3]));
  //print("switch_state: " + switch_state);
  let previous_current_ten_percent_deviation = 0;											// in order to fetch from NW API
  let total_current = 0;
  if (simulation) {
    //print("switch state: " + switch_state);

    for (let i = 0; i < first_to_last_to_shed.length; i++) {
      if (switch_state[first_to_last_to_shed[i].id] == true && first_to_last_to_shed[i].measure) {
          //print("Measuring");
          last_known_current[first_to_last_to_shed[i].id] = Number(simulated_current[first_to_last_to_shed[i].id]);
          current_vector[first_to_last_to_shed[i].id] = Number(simulated_current[first_to_last_to_shed[i].id]);
      }
      else {
        //print("Dont measure");
        current_vector[first_to_last_to_shed[i].id] = 0;
      }
    }
    //print("current vector: " + current_vector);
  }
  else { //FIX!!!!
    for (let i = 0; i < let first_to_last_to_shed.length; i++) {
      if (first_to_last_to_shed[i].addr == "localhost" && first_to_last_to_shed[i].measure){
      	current_vector[first_to_last_to_shed[i].id] = Shelly.getComponentStatus("switch:" + first_to_last_to_shed[i].id).current;
      	if (idx_next_to_toggle_off <= i) 
	      last_known_current[i] = current_vector[i];
      }
      else if ( first_to_last_to_shed[i].measure)
	queueShellyCall("HTTP.GET", { url: "http://" + first_to_last_to_shed[i].addr +
                  "/rpc/Shelly.GetStatus?switch:" + i }, 
			function(result, error_code, error_message, idx) {
			  if( def( result )) {
			    current_vector[idx] = result.current;
			    if (idx_next_to_toggle_off <= i) 
	  		      last_known_current[i] = current_vector[i];
			  }
      }, 
      i);
    }
  }
  for (let i = 0; i < current_vector.length; i++)
    total_current += current_vector[i];
  if (previous_current_ten_percent_deviation && 
      (total_current > previous_current_ten_percent_deviation*1.1 ||
      total_current <= previous_current_ten_percent_deviation*0.9)) {
    log(LOG_INFO, "Current has changed more than 10% since last report, from: " 
        + previous_current_ten_percent_deviation + " A - to: " + total_current + " A");
    previous_current_ten_percent_deviation = total_current;
  }
  return total_current;
}


/* function turn()
 * Turns the switch first_to_last_to_shed[idx] on or off */
function turn(idx, dir) {
  o = first_to_last_to_shed[idx];
  log(LOG_INFO, "Turning switch " + o.id + " to " + dir);
  on = dir == "on" ? true : false;
  switch_state[o.id] = on;
  if(simulation)
	return;
  if (def(o.gen)) {
    let cmd;
    if (o.gen == 1) cmd = o.type + "/" + o.id.toString() + "?turn=" + dir;
    else cmd = "rpc/" + o.type + ".Set?id=" + o.id.toString() + "&on=" + on;
    queueShellyCall("HTTP.GET", { url: "http://" + o.addr + "/" + cmd }, turnCallBack, {idx});
  }
  if (def(o.on_url) && dir == "on")
    queueShellyCall("HTTP.GET", { url: o.on_url }, turnCallBack, {idx});
  if (def(o.off_url) && dir == "off")
    queueShellyCall("HTTP.GET", { url: o.off_url }, turnCallBack, {idx});
}


/* function turnCallBack()
 * Callback function from turn() */
function turnCallBack(result, error_code, error_message, idx) {
  if (error_code != 0);
    log(LOG_ERROR, "failed to operate switch " + idx + "Error: " + error_message);
    // TBD: currently we don't have any retry logic
  else
    log(LOG_INFO, "switch " + idx + " operated successfully");
}


/* function updateSettingsFromKVS();
 * This functions sets the script variables from the Shelly Key-Value store which can be user set. */
function updateSettingsFromKVS(){
  //print("GOT KVS UPDATE");
  queueShellyCall("KVS.GetMany", {},
    function (result, error_code, error_message) {
      for (let KVS in result.items) {
        switch (result.items[KVS].key){

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
              log(LOG_INFO, "Fuse cool down time befor re-loading changed to: " +
                  result.items[KVS].value);
            }
            break;

          case "first_to_last_to_shed":
            if (first_to_last_to_shed != result.items[KVS].value) {
              first_to_last_to_shed = result.items[KVS].value;
              log(LOG_INFO, "Shedding scheme has changed to: " + result.items[KVS].value);
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

          case "factory_reset_to_default":
            log(LOG_INFO, "Reboot to factory default");
            queueShellyCall("KVS.List", {}, 
                            function (result, error_code, error_message) {
		                      for (key in result.keys) {
		                        queueShellyCall("KVS.DELETE", {key:key},
		                          function(result, error_code, error_message) {
                                    return;
                                  }
                                );
		                      }
                              return;
                            }
            );
            Timer.set(5000, false, reboot);
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
           function(result, error_code, error_message){
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
  for(let i=0; i<keys.length; i++){
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
  deleteKV(["hostname_setting", "fuse_rating_setting", "fuse_char_setting", "margin_factor_setting",
           "cool_down_time_setting", "first_to_last_to_shed", "time_to_test_loading_setting",
           "scan_interval", "current_restriction_hysteresis_setting", "overload_webhook_uri_setting",
           "log_level_setting"], cb, params);
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
  createKV("first_to_last_to_shed", first_to_last_to_shed, false);
  createKV("time_to_test_loading_setting", time_to_test_loading_setting, false);
  createKV("scan_interval", scan_interval, false);
  //createKV("simulation", simulation, false);
  //createKV("simulated_current", simulated_current, false);
  //createKV("current_restriction_setting", current_restriction_setting, false);
  createKV("current_restriction_hysteresis_setting", current_restriction_hysteresis_setting, false);
  createKV("overload_webhook_uri_setting", overload_webhook_uri_setting, false);
  createKV("log_level_setting", log_level_setting, false);
}

function nextIdxToLoad(){
  let idx_next_to_toggle_off_tmp = idx_next_to_toggle_off;
  while (idx_next_to_toggle_off_tmp > 0) {
    idx_next_to_toggle_off_tmp--;
    if (first_to_last_to_shed[idx_next_to_toggle_off_tmp].shed)
      break;
   }
   return idx_next_to_toggle_off_tmp;
}

/* function scanPower()
 * Main scan loop, gets invoked every "scan_interval" seconds. */
function scanPower() {
  current_scan_time  += scan_interval;
  if (!last_overrun)
	overrun_cnt = 0;
  if (running) {
    last_overrun = true;
    overrun_cnt++;
    log(LOG_WARN, "Overrun, count is: " + overrun_cnt++);
    running = false;
    return;
  }
  running = true;
  last_overrun = false;
  if (!(current_scan_time % 10)) 
    checkKVS();
  total = get_current();
  time_to_test_loading -= scan_interval;
  if (idx_next_to_toggle_off && time_to_test_loading <= 0) {
    //print(last_known_current);
    last_known_current[first_to_last_to_shed[nextIdxToLoad()].id] = 0;
    time_to_test_loading = time_to_test_loading_setting;
    log(LOG_INFO, "Will test load despite that the last known load does not fit the load budget");
    //print(last_known_current);
    //print(nextIdxToLoad());
    //print(first_to_last_to_shed[nextIdxToLoad()].id);
  }
  let must_shed = mustShed(total);
  let can_load = canLoad(total);
  if (idx_next_to_toggle_off < first_to_last_to_shed.length & must_shed) {
    direction = "shedding";
    time_to_test_loading = time_to_test_loading_setting;
  }
  else if (idx_next_to_toggle_off && can_load && total + 
           last_known_current[first_to_last_to_shed[nextIdxToLoad()].id] <= fuse_rating_setting) {
      //print("loading " + last_known_current + " " + total + " " + first_to_last_to_shed[idx_next_to_toggle_off-1].id);
      direction = "loading";
  }
  else {
    direction = "coasting";
  }
  if (direction == "loading") {
    coasting_report_cnt = 0;
    if (idx_next_to_toggle_off > 0) { 
      while (idx_next_to_toggle_off > 0) {
        idx_next_to_toggle_off--;
        if (first_to_last_to_shed[idx_next_to_toggle_off].shed)
          break;
      }
      if (first_to_last_to_shed[idx_next_to_toggle_off].shed) {
        if (overload_webhook_uri_setting != "" && hostname_setting != "") {
          print("SENDING A WEBHOOK for idx: " + idx_next_to_toggle_off);
          /*queueShellyCall("HTTP.POST", { url: overload_webhook_uri_setting, body: 
                          {hostname: hostname_setting, state: "Loading", current: total,
                          next_to_discconect: first_to_last_to_shed[idx_next_to_toggle_off].id}}, 
		                  function(result, error_code, error_message, idx) {
			                return;
                          }
                          );*/
        }
        log(LOG_INFO, "Loading channel " + first_to_last_to_shed[idx_next_to_toggle_off].id + ", current before loading is: " +
                       total +" A, expected current after loading is: " + 
                       (total + last_known_current[first_to_last_to_shed[idx_next_to_toggle_off].id]) + " A");
        
        turn(idx_next_to_toggle_off, "on");
      }
      else 
        log(LOG_INFO, "No more channels to load");
    }
  }
  if (direction == "shedding") {
    coasting_report_cnt = 0;
    if (idx_next_to_toggle_off != first_to_last_to_shed.length) {
      if (first_to_last_to_shed[idx_next_to_toggle_off].shed) {
        if (overload_webhook_uri_setting != "" && hostname_setting != "") {
          print("SENDING A WEBHOOK for idx: " + idx_next_to_toggle_off);
          /*queueShellyCall("HTTP.POST", { url: overload_webhook_uri_setting, body: 
                          {hostname: hostname_setting, state: "Shedding", current: total,
                          next_to_discconect: first_to_last_to_shed[idx_next_to_toggle_off].id}}, 
			              function(result, error_code, error_message) {
			                return;
                          }
                          );*/
        }
        log(LOG_INFO, "Shedding channel " + first_to_last_to_shed[idx_next_to_toggle_off].id + ", current before shedding is: "
              + total + " A, expected current after shedding is: " +
              + (total - last_known_current[first_to_last_to_shed[idx_next_to_toggle_off].id]) + " A");              
        turn(idx_next_to_toggle_off, "off");
      }
      else
        log(LOG_WARN, "No more channels to shed");
      while (idx_next_to_toggle_off < first_to_last_to_shed.length) {
        idx_next_to_toggle_off++;
        if (idx_next_to_toggle_off>=first_to_last_to_shed.length || first_to_last_to_shed[idx_next_to_toggle_off].shed)
          break;
      }    
    }
  }
  else 
    no_more_can_ched_msg = false;
  if (direction == "coasting") {
     if (coasting_report_cnt * scan_interval * (overrun_cnt + 1) >= 60)
        coasting_report_cnt = 0;
     else
       coasting_report_cnt++;
     /*if (!coasting_report_cnt)
       queueShellyCall("HTTP.POST", { url: overload_webhook_uri_setting, body: 
                       {hostname: hostname_setting, state: "Shedding", current: total,
                        next_to_discconect: first_to_last_to_shed[idx_next_to_toggle_off].id}}, 
			function(result, error_code, error_message) {
			  return;
            });*/
  }
  running = false;
  return;
}
/*********************************************************************************************************/

/*********************************************************************************************************/
/*                                              main/init                                                */
/*********************************************************************************************************/
for (let i = 0; i < first_to_last_to_shed.length; i++) turn(i, switch_state[i] ? "on" : "off");
updateKvs();
HTTPServer.registerEndpoint("shedder", shedderEndPoint);
Shelly.addEventHandler(shellyEventCb); 
Timer.set(scan_interval * 1000, true, scanPower);


/*********************************************************************************************************/
