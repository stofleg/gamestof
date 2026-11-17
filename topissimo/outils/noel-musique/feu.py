# Feu de cheminée (40 s, boucle sans couture) : grondement des flammes, souffle, crépitements
# (fins et secs, en grappes) et quelques « pops » de bois résineux plus graves.
import numpy as np, wave
sr=44100; D=40; n=sr*D; rng=np.random.default_rng(12)
def filtre(x, lo, hi):
    X=np.fft.rfft(x); f=np.fft.rfftfreq(len(x),1/sr)
    m=np.ones_like(f)
    if lo: m*=1/(1+(lo/np.maximum(f,1))**4)
    if hi: m*=1/(1+(f/hi)**4)
    return np.fft.irfft(X*m,len(x))
def lent(nb, k):   # modulation lente et lisse, périodique sur la boucle
    c=rng.standard_normal(nb); X=np.fft.rfft(c); X[k:]=0; y=np.fft.irfft(X,nb)
    return np.interp(np.arange(n), np.linspace(0,n,nb,endpoint=False), y, period=n)
t=np.arange(n)/sr
# grondement (bruit brun filtré) modulé par des « bouffées » de flammes
brun=np.cumsum(rng.standard_normal(n)); brun-=np.convolve(brun,np.ones(sr)/sr,'same')
grond=filtre(brun,40,220); grond/=np.abs(grond).max()
mod=1+0.45*lent(400,12)/np.abs(lent(400,12)).max()
grond*=mod
# souffle des flammes : bruit rose doux 300–2500 Hz, modulé
blanc=rng.standard_normal(n); souffle=filtre(blanc,300,2500); souffle/=np.abs(souffle).max()
souffle*=0.5+0.5*np.clip(lent(800,30),0,None)/np.abs(lent(800,30)).max()
sortie=np.zeros((n,2))
sortie[:,0]+=grond*.55+souffle*.10; sortie[:,1]+=grond*.55+souffle*.10
# crépitements : processus en grappes
tc=0.0
while tc<D-0.1:
    tc+=rng.exponential(0.09 if rng.random()<.7 else .45)
    grappe=1 if rng.random()<.75 else rng.integers(2,7)
    for g in range(grappe):
        tt=tc+g*rng.uniform(.004,.03)
        if tt>=D-0.06: break
        L=int(sr*rng.uniform(.0006,.004)); i=int(tt*sr)
        imp=rng.standard_normal(L)*np.exp(-np.arange(L)/(L/4))
        amp=np.exp(np.minimum(rng.normal(-2.4,.6),-1.2))
        imp=filtre(np.pad(imp,(0,256)), rng.uniform(1500,4000), rng.uniform(7000,14000))[:L+256]*amp
        p=rng.uniform(-.8,.8)
        sortie[i:i+len(imp),0]+=imp*(1-p)/2*1.6; sortie[i:i+len(imp),1]+=imp*(1+p)/2*1.6
# pops de bois : plus rares, résonants (300–900 Hz) avec une queue
tp=0.0
while tp<D-0.3:
    tp+=rng.exponential(2.2)
    if tp>=D-0.3: break
    i=int(tp*sr); L=int(sr*rng.uniform(.03,.08)); f0=rng.uniform(300,900)
    k=np.arange(L)/sr; pop=np.sin(2*np.pi*f0*k)*np.exp(-k/rng.uniform(.006,.018))
    pop+= rng.standard_normal(L)*np.exp(-k/.004)*.6
    amp=np.exp(rng.normal(-2.3,.4)); p=rng.uniform(-.6,.6)
    sortie[i:i+L,0]+=pop*amp*(1-p)/2; sortie[i:i+L,1]+=pop*amp*(1+p)/2
# boucle sans couture : fondu enchaîné de 1,5 s de la fin sur le début
F=int(sr*1.5); r=np.linspace(0,1,F)[:,None]
debut=sortie[:F].copy(); sortie[:F]=debut*r+sortie[-F:]*(1-r); sortie=sortie[:-F]
sortie/=np.abs(sortie).max()*1.12
w=wave.open("feu.wav","wb"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes((sortie*32767).astype(np.int16).tobytes()); w.close()
print("feu", len(sortie)/sr, "s")
