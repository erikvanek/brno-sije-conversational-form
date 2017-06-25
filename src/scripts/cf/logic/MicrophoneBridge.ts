/// <reference path="../ui/BasicElement.ts"/>
/// <reference path="../ui//control-elements/ControlElements.ts"/>
/// <reference path="../logic/FlowManager.ts"/>
/// <reference path="../interfaces/IUserInputElement.ts"/>
/// <reference path="../ui/inputs/UserInputElement.ts"/>
/// <reference path="../interfaces/IUserInputElement.ts"/>

// namespace
namespace cf {
	// interface
	export interface IMicrophoneBridgeOptions{
		el: HTMLElement;
		button: UserInputSubmitButton;
		microphoneObj: IUserInput;
		eventTarget: EventDispatcher;
	}

	export const MicrophoneBridgeEvent = {
		ERROR: "cf-microphone-bridge-error",
		TERMNIAL_ERROR: "cf-microphone-bridge-terminal-error"
	}

	// class
	export class MicrophoneBridge{
		private equalizer: SimpleEqualizer;
		private el: HTMLElement;
		private button: UserInputSubmitButton;
		private currentTextResponse: string = "";
		private recordChunks: Array<any>;
		// private equalizer: SimpleEqualizer;
		private promise: Promise<any>;
		private currentStream: MediaStream;
		private _hasUserMedia: boolean = false;
		private inputErrorCount: number = 0;
		private inputCurrentError: string = "";
		private microphoneObj: IUserInput;
		private eventTarget: EventDispatcher;
		private flowUpdateCallback: () => void;

		private set hasUserMedia(value: boolean){
			this._hasUserMedia = value;
			if(!value){
				// this.submitButton.classList.add("permission-waiting");
			}else{
				// this.submitButton.classList.remove("permission-waiting");
			}
		}

		constructor(options: IMicrophoneBridgeOptions){
			this.el = options.el;
			this.button = options.button;
			this.eventTarget = options.eventTarget;

			// data object
			this.microphoneObj = options.microphoneObj;

			this.flowUpdateCallback = this.onFlowUpdate.bind(this);
			this.eventTarget.addEventListener(FlowEvents.FLOW_UPDATE, this.flowUpdateCallback, false);
		}

		public cancel(){
			this.button.loading = false;

			if(this.microphoneObj.cancelInput){
				this.microphoneObj.cancelInput();
			}
		}

		public onFlowUpdate(){
			this.currentTextResponse = null;

			if(!this._hasUserMedia){
				// check if user has granted
				let hasGranted: boolean = false;
				if((<any> window).navigator.mediaDevices){
					(<any> window).navigator.mediaDevices.enumerateDevices().then((devices: any) => {
						devices.forEach((device: any) => {
							if(!hasGranted && device.label !== ""){
								hasGranted = true;
							}
						});

						if(hasGranted){
							// user has previously granted, so call getusermedia, as this wont prombt user
							this.getUserMedia();
						}else{
							// await click on button, wait state
						}
					});
				}
			}else{
				// user has granted ready to go go
				if(!this.microphoneObj.awaitingCallback){
					this.callInput();
				}
			}
		}
		
		public getUserMedia(){
			try{
				navigator.getUserMedia = navigator.getUserMedia || (<any>window).navigator.webkitGetUserMedia || (<any>window).navigator.mozGetUserMedia;
				navigator.getUserMedia(<any> {audio: true}, (stream: MediaStream) => {
					this.currentStream = stream;

					if(stream.getAudioTracks().length > 0){
						// interface is active and available, so call it immidiatly
						this.hasUserMedia = true;
						this.setupEqualizer();

						if(!this.microphoneObj.awaitingCallback){
							// microphone interface awaits speak out loud callback
							this.callInput();
						}
					}else{
						// code for when both devices are available
						// interface is not active, button should be clicked
						this.hasUserMedia = false;
					}
				}, (error: any) =>{
					// error..
					// not supported..
					this.hasUserMedia = false;
					this.eventTarget.dispatchEvent(new Event(MicrophoneBridgeEvent.TERMNIAL_ERROR));
				});
			}catch(error){
				// whoops
				// roll back to standard UI

				this.eventTarget.dispatchEvent(new Event(MicrophoneBridgeEvent.TERMNIAL_ERROR));
			}
		}

		public dealloc(){
			this.cancel();

			this.promise = null;
			this.currentStream = null;

			if(this.equalizer){
				this.equalizer.dealloc();
			}

			this.equalizer = null;

			this.eventTarget.removeEventListener(FlowEvents.FLOW_UPDATE, this.flowUpdateCallback, false);
			this.flowUpdateCallback = null;
		}

		public callInput(messageTime: number = 0){
			// remove current error message after x time
			// clearTimeout(this.clearMessageTimer);
			// this.clearMessageTimer = setTimeout(() =>{
			// 	this.el.removeAttribute("message");
			// }, messageTime);

			this.button.loading = true;

			if(this.equalizer){
				this.equalizer.disabled = false;
			}

			// call API, SpeechRecognintion etc. you decide, passing along the stream from getUserMedia can be used.. as long as the resolve is called with string attribute
			this.promise = new Promise((resolve: any, reject: any) => this.microphoneObj.input(resolve, reject, this.currentStream) )
			.then((result) => {

				// api contacted
				this.promise = null;
				// save response so it's available in getFlowDTO
				this.currentTextResponse = result.toString();
				if(!this.currentTextResponse || this.currentTextResponse == ""){
					this.showError(Dictionary.get("user-audio-reponse-invalid"));
					// invalid input, so call API again
					this.callInput();
					return;
				}

				this.inputErrorCount = 0;
				this.inputCurrentError = "";
				this.button.loading = false;

				// continue flow
				let dto: FlowDTO = <FlowDTO> {
					text: this.currentTextResponse
				};

				ConversationalForm.illustrateFlow(this, "dispatch", UserInputEvents.SUBMIT, dto);
				this.eventTarget.dispatchEvent(new CustomEvent(UserInputEvents.SUBMIT, {
					detail: dto
				}));
			}).catch((error) => {
				// API error
				ConversationalForm.illustrateFlow(this, "dispatch", MicrophoneBridgeEvent.ERROR, error);
				// this.eventTarget.dispatchEvent(new CustomEvent(MicrophoneBridgeEvent.ERROR, {
				// 	detail: error
				// }));

				console.log("error...", this.inputCurrentError)

				if(this.isErrorTerminal(error)){
					// terminal error, fallback to 
					this.eventTarget.dispatchEvent(new CustomEvent(MicrophoneBridgeEvent.TERMNIAL_ERROR,{
						detail: Dictionary.get("microphone-terminal-error") + error
					}));
				}else{
					if(this.inputCurrentError != error){
						// api failed ...
						// show result in UI
						this.inputErrorCount = 0;
						this.inputCurrentError = error;
					}else{
					}

					this.inputErrorCount++;

					if(this.inputErrorCount < 3){
						this.showError(this.inputCurrentError);
					}else{
						this.eventTarget.dispatchEvent(new CustomEvent(MicrophoneBridgeEvent.TERMNIAL_ERROR,{
							detail: Dictionary.get("microphone-terminal-error") + error
						}));
					}
				}
			});
		}

		protected isErrorTerminal(error: string): boolean{
			const terminalErrors: Array<string> = ["network"];
			if(terminalErrors.indexOf(error) !== -1)
				return true;

			return false;
		}

		private showError(error: string){
			const dto: FlowDTO = {
				errorText: error
			};

			ConversationalForm.illustrateFlow(this, "dispatch", FlowEvents.USER_INPUT_INVALID, dto)
			this.eventTarget.dispatchEvent(new CustomEvent(FlowEvents.USER_INPUT_INVALID, {
				detail: dto
			}));

			this.callInput();
		}

		private setupEqualizer(){
			const eqEl: HTMLElement = <HTMLElement> this.el.getElementsByTagName("cf-icon-audio-eq")[0];
			if(SimpleEqualizer.supported && eqEl){
				this.equalizer = new SimpleEqualizer({
					stream: this.currentStream,
					elementToScale: eqEl
				});
			}
		}
	}

	class SimpleEqualizer{
		private context: AudioContext;
		private analyser: AnalyserNode;
		private mic: MediaStreamAudioSourceNode;
		private javascriptNode: ScriptProcessorNode;
		private elementToScale: HTMLElement;
		private maxBorderWidth: number;

		private _disabled: boolean = false;
		public set disabled(value: boolean){
			this._disabled = value;
			this.elementToScale.style.borderWidth = 0 + "px";
		}
		constructor(options: any){
			this.elementToScale = options.elementToScale;
			this.context = new AudioContext();
			this.analyser = this.context.createAnalyser();
			this.mic = this.context.createMediaStreamSource(options.stream);
			this.javascriptNode = this.context.createScriptProcessor(2048, 1, 1);

			this.analyser.smoothingTimeConstant = 0.3;
			this.analyser.fftSize = 1024;
			this.maxBorderWidth = this.elementToScale.offsetWidth * 0.5;

			this.mic.connect(this.analyser);
			this.analyser.connect(this.javascriptNode);
			this.javascriptNode.connect(this.context.destination);
			this.javascriptNode.onaudioprocess = () => {
				this.onAudioProcess();
			};
		}

		private onAudioProcess(){
			if(this._disabled)
				return;

			var array =  new Uint8Array(this.analyser.frequencyBinCount);
			this.analyser.getByteFrequencyData(array);
			var values = 0;

			var length = array.length;
			for (var i = 0; i < length; i++) {
				values += array[i];
			}

			var average = values / length;
			const percent: number = 1 - ((100 - average) / 100);
			this.elementToScale.style.borderWidth = (this.maxBorderWidth * percent) + "px";
		}

		public dealloc(){
			this.javascriptNode.onaudioprocess = null;
			this.javascriptNode = null;
			this.analyser = null;
			this.mic = null;
			this.elementToScale = null;
			this.context = null;
		}

		public static supported():boolean{
			(<any>window).AudioContext = (<any>window).AudioContext || (<any>window).webkitAudioContext;
			if((<any>window).AudioContext){
				return true;
			}
			else {
				return false;
			}
		}
	}
}