import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BentoShutter } from './bento-shutter/bento-shutter';

/** Landing page công khai — nav tối giản + cảnh cuộn "Bento Shutter Reveal" + footer. */
@Component({
  selector: 'app-landing',
  imports: [RouterLink, BentoShutter],
  templateUrl: './landing.html',
  styleUrl: './landing.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Landing {}
