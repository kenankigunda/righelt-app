import {runWithFirefoxAudio} from './testing/linux-audio.mjs';
try{process.exitCode=await runWithFirefoxAudio(process.argv.slice(2));}
catch(error){console.error(error);process.exitCode=1;}
