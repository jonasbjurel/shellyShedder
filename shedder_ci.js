let verification_phase = 0;
let verification_sub_phase = 0;
let verification_sub_sub_phase = 0;
let verification_current_vector = new Array(8);
let verification_trip_time = 0;
let wait_for_shed = 0;
let wait_for_cool = 0;
/*********************************************************************************************************/

/*********************************************************************************************************/
/*                                         CI/CD verification                                            */
/*********************************************************************************************************/

function verificationEngine() {
  switch (verification_phase ) {
    case 0:
// Test setup
      fuse_rating_setting = 16;
      fuse_char_setting = "C";
      margin_factor_setting = 4;
      cool_down_time_setting = 10;
      first_to_last_to_shed = [
        { addr: "localhost", gen: 2, type: "relay", id: 3, shed: true, measure: true },
        { addr: "localhost", gen: 2, type: "relay", id: 2, shed: true, measure: true },
        { addr: "localhost", gen: 2, type: "relay", id: 1, shed: true, measure: true },
        { addr: "localhost", gen: 2, type: "relay", id: 0, shed: false, measure: true },
      ];
      time_to_test_loading_setting = 30;
      simulation = true;
      simulated_current = new Array(first_to_last_to_shed.length);
      for (let i = 0; i < first_to_last_to_shed.length; i++) simulated_current[i] = 0;
      let current_restriction_setting = 0;
      let current_restriction_hysteresis_setting = 0.1;
      let log_level_setting = LOG_INFO;
      verification_phase ++;
      verification_sub_phase=0;
      verification_sub_sub_phase=0;
      log(LOG_INFO, "============ Starting load meassure tests ==============");
      break;
      
//TC 0: Current measurement

    case 1:
      if (verification_sub_phase == 0)
        verification_current_vector = [0,0,0,0,1,1,1,1];
      else
        verification_current_vector.push(verification_current_vector.splice(0,1));
      log(LOG_INFO, "Changing simulated current to " + verification_current_vector.slice(0,4));
      queueShellyCall(HTTP.GET, {url:"http://localhost/script/3/shedder?" +
                                      "setSimulatedCurrent=[" +
                                      verification_current_vector.slice(0,4) + "]"}, 
                                      function(result, error_code, error_message) {
                                        return;
                                      }
                                      );
      //simulated_current = verification_current_vector.slice(0,4);
      verification_phase++;
      verification_sub_sub_phase=0;
      break;
     
    case 2:
      if (verification_sub_sub_phase == 4) {
        let expected_current = 0;
        //print("currentVector: " + verification_current_vector.slice(0,4));
        for (let i=0; i<verification_current_vector.slice(0,4).length; i++) {
          expected_current += Number(verification_current_vector.slice(0,4)[i]);
          //print("Channel current: " + verification_current_vector.slice(0,4)[i]);
          //print("expected_current: " + expected_current);
        }
       //print(total + "!=" + expected_current);

        if (total != expected_current) {
          log(LOG_ERROR, "Current measurement error, expected " + expected_current + " A, got " + total + " A");
          queueShellyCall('Script.Stop', {id: Shelly.getCurrentScriptId()});
        }
        else
          log(LOG_INFO, "Current measurement success, expected " + expected_current + " A, got " + total + " A");
        if (verification_sub_phase > 7) {
          verification_phase++;
          verification_sub_phase = 0;
          verification_sub_sub_phase = 0;
          log(LOG_INFO, "============ Starting non-tripping load test with currents up to 1.13*In ==============");
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
       
//TC 1: Persistant under-load.
//TC 1.1: Running simulated output with permutations of non tripping load
    case 3:
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
for (let i = 0; i < first_to_last_to_shed.length; i++) turn(i, switch_state[i] ? "on" : "off");
if (!cicd_verification_setting)
  updateKvs();
HTTPServer.registerEndpoint("shedder", shedderEndPoint);
Shelly.addEventHandler(shellyEventCb); 
Timer.set(scan_interval * 1000, true, scanPower);
if(cicd_verification_setting) {
  Timer.set(100, true, verificationEngine);
}
